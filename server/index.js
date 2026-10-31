// Twisted Cafe API + realtime + static web app.
import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { Server } from "socket.io";
import QRCode from "qrcode";
import { db, getSettings, setSettings, tx } from "./db.js";
import {
  checkPin, hashPin, makeToken, readToken, parseCookies, sessionCookie, clearCookie, COOKIE_NAME, rateLimiter,
} from "./auth.js";
import {
  HttpError, buildLines, createOrder, payOrder, unpayOrder, setStatus, getOrder, getOrderByToken, listOrders,
  publicOrder, parseOptions, cleanText, localParts, nowIso, upsertPerson, PAY_METHODS, evaluateDiscount,
} from "./orders.js";
import { summary, itemsCsv, ordersCsv } from "./reports.js";
import { importPos2 } from "./importPos2.js";
import { auditMiddleware, setLogListener } from "./audit.js";
import { allNames, duplicateGroups, mergeNames, ignorePair } from "./people.js";
import { rewardBalances, rewardHistory, adjustPoints, balanceOf, rewardConfig, pointsValue } from "./rewards.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "50mb" }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
app.use(auditMiddleware({ currentUser, getSettings }));
setLogListener((line) => io.to("admins").emit("log", line));

// ── Helpers ───────────────────────────────────────────────────────
const loginLimit = rateLimiter(10, 5 * 60_000);
const codeLimit = rateLimiter(15, 10 * 60_000);
const orderLimit = rateLimiter(20, 10 * 60_000);
const discountLimit = rateLimiter(30, 10 * 60_000);

function currentUser(req) {
  const data = readToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  if (!data) return null;
  return db.prepare("SELECT id, name, role FROM users WHERE id = ? AND active = 1").get(data.uid) || null;
}
function staff(req, _res, next) {
  req.user = currentUser(req);
  if (!req.user) throw new HttpError(401, "Not signed in");
  next();
}
function admin(req, res, next) {
  staff(req, res, () => {
    if (req.user.role !== "admin") throw new HttpError(403, "Admin only");
    next();
  });
}
const int = (v) => Math.trunc(Number(v));
const money = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new HttpError(400, "Bad amount");
  return n;
};
const bool = (v) => (v ? 1 : 0);

function emitOrder(id) {
  const o = getOrder(id);
  if (!o) return;
  io.to("staff").emit("order", o);
  io.to(`o:${o.token}`).emit("public-order", publicOrder(o));
}
const emitMenu = () => io.emit("menu-changed");

function slugify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
    || `room-${crypto.randomBytes(2).toString("hex")}`;
}
function newCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, "0");
}
function sameCode(a, b) {
  return String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();
}

function sanitizeOptionGroups(groups) {
  if (!Array.isArray(groups)) return "[]";
  const clean = groups.slice(0, 10).map((g) => ({
    name: cleanText(g?.name, 40) || "Option",
    name_ar: cleanText(g?.name_ar, 40),
    type: g?.type === "multi" ? "multi" : "single",
    required: !!g?.required,
    choices: (Array.isArray(g?.choices) ? g.choices : []).slice(0, 20)
      .map((c) => ({ name: cleanText(c?.name, 40), price: money(c?.price || 0) }))
      .filter((c) => c.name),
  })).filter((g) => g.choices.length);
  return JSON.stringify(clean);
}

function menuPayload({ publicOnly = false } = {}) {
  const categories = db.prepare(
    `SELECT * FROM categories WHERE deleted = 0 ${publicOnly ? "AND active = 1" : ""} ORDER BY sort, id`,
  ).all();
  const items = db.prepare(
    `SELECT * FROM items WHERE deleted = 0 ${publicOnly ? "AND room_orderable = 1" : ""} ORDER BY sort, id`,
  ).all().map((i) => ({ ...i, options: parseOptions(i.options) }));
  return { categories, items };
}

function roomBySlug(slug) {
  return db.prepare("SELECT * FROM rooms WHERE slug = ?").get(String(slug));
}

// ── Auth ──────────────────────────────────────────────────────────
app.post("/api/auth/login", (req, res) => {
  if (!loginLimit(req.ip)) throw new HttpError(429, "Too many attempts. Wait 5 minutes.");
  const pin = String(req.body?.pin ?? "");
  if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, "PIN is 4-8 digits");
  const users = db.prepare("SELECT * FROM users WHERE active = 1").all();
  const user = users.find((u) => checkPin(pin, u.pin_hash));
  if (!user) throw new HttpError(401, "Wrong PIN");
  res.setHeader("Set-Cookie", sessionCookie(makeToken(user)));
  res.json({ id: user.id, name: user.name, role: user.role });
});
app.post("/api/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearCookie);
  res.json({ ok: true });
});
app.get("/api/auth/me", (req, res) => {
  res.json({ user: currentUser(req) });
});

// ── Public (room QR ordering) ─────────────────────────────────────
app.get("/api/public/info", (_req, res) => {
  const s = getSettings();
  res.json({ cafeName: s.cafeName, roomOrdering: s.roomOrdering });
});
app.get("/api/public/rooms/:slug", (req, res) => {
  const r = roomBySlug(req.params.slug);
  if (!r || !r.active) throw new HttpError(404, "Room not found");
  res.json({ name: r.name, slug: r.slug });
});
app.post("/api/public/rooms/:slug/verify", (req, res) => {
  if (!codeLimit(req.ip)) throw new HttpError(429, "Too many tries. Wait 10 minutes.");
  const r = roomBySlug(req.params.slug);
  if (!r || !r.active) throw new HttpError(404, "Room not found");
  if (!sameCode(req.body?.code, r.code)) throw new HttpError(403, "Wrong room code. Check the card in the room.");
  // Employee names are never sent to phones; people type their own name.
  res.json({ ok: true, people: [] });
});
app.get("/api/public/menu", (_req, res) => {
  res.json(menuPayload({ publicOnly: true }));
});
app.post("/api/public/orders", (req, res) => {
  if (!orderLimit(req.ip)) throw new HttpError(429, "Too many orders. Ask the counter.");
  if (getSettings().roomOrdering !== "open") throw new HttpError(409, "Room ordering is closed right now");
  const b = req.body || {};
  const r = roomBySlug(b.room);
  if (!r || !r.active) throw new HttpError(404, "Room not found");
  if (!sameCode(b.code, r.code)) throw new HttpError(403, "Room code changed. Enter the new code from the card.");
  const name = cleanText(b.name, 60);
  if (name.length < 2) throw new HttpError(400, "Enter your name");
  const payPref = ["cash", "card", "tab"].includes(b.payPref) ? b.payPref : null;
  const lines = buildLines(b.items, { forRoom: true });
  const id = createOrder({
    source: "room", room: r, customerName: name, note: b.note, lines, payPref,
    discountCode: cleanText(b.discountCode, 40) || null,
  });
  emitOrder(id);
  res.json(publicOrder(getOrder(id)));
});
app.get("/api/public/orders/:token", (req, res) => {
  const o = getOrderByToken(req.params.token);
  if (!o) throw new HttpError(404, "Order not found");
  res.json(publicOrder(o));
});

// ── Menu ──────────────────────────────────────────────────────────
app.get("/api/menu", staff, (_req, res) => res.json(menuPayload()));

app.post("/api/categories", admin, (req, res) => {
  const name = cleanText(req.body?.name, 60);
  if (!name) throw new HttpError(400, "Name required");
  const sort = (db.prepare("SELECT MAX(sort) AS m FROM categories WHERE deleted = 0").get().m ?? -1) + 1;
  const id = db.prepare("INSERT INTO categories(name, name_ar, sort) VALUES(?,?,?)")
    .run(name, cleanText(req.body?.name_ar, 60), sort).lastInsertRowid;
  emitMenu();
  res.json(db.prepare("SELECT * FROM categories WHERE id = ?").get(id));
});
app.patch("/api/categories/:id", admin, (req, res) => {
  const c = db.prepare("SELECT * FROM categories WHERE id = ?").get(int(req.params.id));
  if (!c) throw new HttpError(404, "Not found");
  const b = req.body || {};
  db.prepare("UPDATE categories SET name=?, name_ar=?, sort=?, active=? WHERE id=?").run(
    b.name !== undefined ? cleanText(b.name, 60) || c.name : c.name,
    b.name_ar !== undefined ? cleanText(b.name_ar, 60) : c.name_ar,
    b.sort !== undefined ? int(b.sort) : c.sort,
    b.active !== undefined ? bool(b.active) : c.active,
    c.id,
  );
  emitMenu();
  res.json(db.prepare("SELECT * FROM categories WHERE id = ?").get(c.id));
});
// Delete a category. If it still has items, the client must confirm with ?withItems=1 (items are soft-deleted,
// so past sales keep their names). Categories are only hidden in the DB, never hard-deleted.
app.delete("/api/categories/:id", admin, (req, res) => {
  const id = int(req.params.id);
  const cat = db.prepare("SELECT * FROM categories WHERE id = ? AND deleted = 0").get(id);
  if (!cat) throw new HttpError(404, "Category not found");
  const n = db.prepare("SELECT COUNT(*) AS n FROM items WHERE category_id = ? AND deleted = 0").get(id).n;
  if (n && req.query.withItems !== "1") {
    res.status(409).json({ error: `"${cat.name}" still has ${n} item(s)`, items: n, needsConfirm: true });
    return;
  }
  tx(() => {
    db.prepare("UPDATE items SET deleted = 1 WHERE category_id = ? AND deleted = 0").run(id);
    db.prepare("UPDATE categories SET deleted = 1, active = 0 WHERE id = ?").run(id);
  });
  emitMenu();
  res.json({ ok: true, itemsDeleted: n });
});

function itemFromBody(b, base = {}) {
  const pick = (k, f) => (b[k] !== undefined ? f(b[k]) : base[k]);
  return {
    category_id: pick("category_id", int),
    name: pick("name", (v) => cleanText(v, 80)),
    name_ar: pick("name_ar", (v) => cleanText(v, 80)) ?? "",
    description: pick("description", (v) => cleanText(v, 300)) ?? "",
    price: pick("price", money),
    options: b.options !== undefined ? sanitizeOptionGroups(b.options) : base.options ?? "[]",
    available: pick("available", bool) ?? 1,
    room_orderable: pick("room_orderable", bool) ?? 1,
    sort: pick("sort", int) ?? 0,
  };
}
app.post("/api/items", admin, (req, res) => {
  const it = itemFromBody(req.body || {});
  if (!it.name) throw new HttpError(400, "Name required");
  if (!db.prepare("SELECT 1 FROM categories WHERE id = ? AND deleted = 0").get(it.category_id)) throw new HttpError(400, "Pick a category");
  if (it.price == null) throw new HttpError(400, "Price required");
  if (req.body?.sort === undefined) {
    it.sort = (db.prepare("SELECT MAX(sort) AS m FROM items WHERE category_id = ?").get(it.category_id).m ?? -1) + 1;
  }
  const id = db.prepare(`INSERT INTO items(category_id, name, name_ar, description, price, options, available, room_orderable, sort)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(it.category_id, it.name, it.name_ar, it.description, it.price, it.options,
    it.available, it.room_orderable, it.sort).lastInsertRowid;
  emitMenu();
  res.json({ id: Number(id) });
});
app.patch("/api/items/:id", admin, (req, res) => {
  const base = db.prepare("SELECT * FROM items WHERE id = ? AND deleted = 0").get(int(req.params.id));
  if (!base) throw new HttpError(404, "Not found");
  const it = itemFromBody(req.body || {}, base);
  if (!it.name) throw new HttpError(400, "Name required");
  db.prepare(`UPDATE items SET category_id=?, name=?, name_ar=?, description=?, price=?, options=?, available=?,
    room_orderable=?, sort=? WHERE id=?`).run(it.category_id, it.name, it.name_ar, it.description, it.price,
    it.options, it.available, it.room_orderable, it.sort, base.id);
  emitMenu();
  res.json({ ok: true });
});
// Any staff can mark an item sold out / back in stock.
app.patch("/api/items/:id/availability", staff, (req, res) => {
  db.prepare("UPDATE items SET available = ? WHERE id = ?").run(bool(req.body?.available), int(req.params.id));
  emitMenu();
  res.json({ ok: true });
});
app.delete("/api/items/:id", admin, (req, res) => {
  db.prepare("UPDATE items SET deleted = 1 WHERE id = ?").run(int(req.params.id));
  emitMenu();
  res.json({ ok: true });
});

// CSV import: needs columns Name, Category, Price (Loyverse item export works; extra columns ignored).
app.post("/api/menu/import", admin, express.text({ type: "*/*", limit: "2mb" }), (req, res) => {
  const rows = parseCsv(String(req.body || "").replace(/^﻿/, ""));
  if (rows.length < 2) throw new HttpError(400, "CSV is empty");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const ni = head.indexOf("name");
  const ci = head.indexOf("category");
  const pi = head.findIndex((h) => h === "price" || h.startsWith("price"));
  if (ni < 0 || pi < 0) throw new HttpError(400, "CSV needs Name and Price columns");
  let added = 0, updated = 0;
  tx(() => {
    for (const r of rows.slice(1)) {
      const name = cleanText(r[ni], 80);
      if (!name) continue;
      const price = Math.round(Number(String(r[pi] ?? "").replace(/[^\d.]/g, "")) * 100) || 0;
      const catName = cleanText(ci >= 0 ? r[ci] : "", 60) || "Imported";
      let cat = db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE ORDER BY deleted, id").get(catName);
      if (cat) db.prepare("UPDATE categories SET deleted = 0, active = 1 WHERE id = ?").run(cat.id);
      if (!cat) {
        const sort = (db.prepare("SELECT MAX(sort) AS m FROM categories").get().m ?? -1) + 1;
        cat = { id: db.prepare("INSERT INTO categories(name, sort) VALUES(?,?)").run(catName, sort).lastInsertRowid };
      }
      const ex = db.prepare("SELECT id FROM items WHERE name = ? COLLATE NOCASE AND deleted = 0").get(name);
      if (ex) {
        db.prepare("UPDATE items SET price = ?, category_id = ? WHERE id = ?").run(price, cat.id, ex.id);
        updated++;
      } else {
        db.prepare("INSERT INTO items(category_id, name, price) VALUES(?,?,?)").run(cat.id, name, price);
        added++;
      }
    }
  });
  emitMenu();
  res.json({ added, updated });
});
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ── Orders ────────────────────────────────────────────────────────
app.get("/api/orders", staff, (req, res) => {
  const day = req.query.day ? String(req.query.day) : null;
  res.json(day ? listOrders({ scope: "day", day }) : listOrders());
});
app.get("/api/orders/:id", staff, (req, res) => {
  const o = getOrder(int(req.params.id));
  if (!o) throw new HttpError(404, "Not found");
  res.json(o);
});
// Counter sale. payment = { method, tabName } or null (pay later).
app.post("/api/orders", staff, (req, res) => {
  const b = req.body || {};
  const lines = buildLines(b.items);
  let room = null;
  if (b.roomId) {
    room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(int(b.roomId));
    if (!room) throw new HttpError(400, "Room not found");
  }
  const payment = b.payment && b.payment.method ? b.payment : null;
  if (payment && !PAY_METHODS.includes(payment.method)) throw new HttpError(400, "Bad payment method");
  const id = createOrder({
    source: room ? "room" : "counter", room, customerName: b.customerName, note: b.note, lines, payment,
    status: b.sendToBar === false ? "completed" : "new", userId: req.user.id,
    discountCode: cleanText(b.discountCode, 40) || null,
    rewardPoints: Math.trunc(Number(b.rewardPoints) || 0) || null,
  });
  emitOrder(id);
  res.json(getOrder(id));
});
app.post("/api/orders/:id/status", staff, (req, res) => {
  const id = int(req.params.id);
  if (req.body?.status === "cancelled" && req.user.role !== "admin") {
    const o = getOrder(id);
    if (o?.payment_status === "paid") throw new HttpError(403, "Only an admin can cancel a paid order");
  }
  setStatus(id, String(req.body?.status), req.body?.reason);
  emitOrder(id);
  res.json(getOrder(id));
});
app.post("/api/orders/:id/pay", staff, (req, res) => {
  const id = int(req.params.id);
  payOrder(id, String(req.body?.method), req.body?.tabName, req.user.id);
  emitOrder(id);
  res.json(getOrder(id));
});
app.post("/api/orders/:id/unpay", admin, (req, res) => {
  const id = int(req.params.id);
  unpayOrder(id);
  emitOrder(id);
  res.json(getOrder(id));
});

// ── Tabs ──────────────────────────────────────────────────────────
function tabBalances() {
  return db.prepare(`
    WITH c AS (SELECT tab_name AS name, SUM(total) AS charged, COUNT(*) AS orders, MAX(created_at) AS last
               FROM orders WHERE payment_method = 'tab' AND status != 'cancelled' GROUP BY tab_name COLLATE NOCASE),
         p AS (SELECT tab_name AS name, SUM(amount) AS paid, MAX(created_at) AS last
               FROM tab_payments GROUP BY tab_name COLLATE NOCASE)
    SELECT c.name AS name, c.charged, c.orders, COALESCE(p.paid, 0) AS paid,
           c.charged - COALESCE(p.paid, 0) AS balance, MAX(c.last, COALESCE(p.last, '')) AS last
    FROM c LEFT JOIN p ON p.name = c.name COLLATE NOCASE
    ORDER BY balance DESC, name`).all();
}
app.get("/api/tabs", staff, (_req, res) => res.json(tabBalances()));
app.get("/api/tabs/:name", staff, (req, res) => {
  const name = String(req.params.name);
  const orders = db.prepare(`SELECT id, number, local_day, total, room_name, created_at,
      (SELECT GROUP_CONCAT(qty || 'x ' || name, ', ') FROM order_items WHERE order_id = orders.id) AS lines
    FROM orders WHERE payment_method = 'tab' AND status != 'cancelled' AND tab_name = ? COLLATE NOCASE
    ORDER BY id DESC`).all(name);
  const payments = db.prepare(`SELECT p.*, u.name AS user_name FROM tab_payments p LEFT JOIN users u ON u.id = p.user_id
    WHERE p.tab_name = ? COLLATE NOCASE ORDER BY p.id DESC`).all(name);
  res.json({ name, orders, payments, balance: tabBalances().find((t) => t.name.toLowerCase() === name.toLowerCase())?.balance ?? 0 });
});
app.post("/api/tabs/:name/pay", staff, (req, res) => {
  const amount = money(req.body?.amount);
  if (amount <= 0) throw new HttpError(400, "Amount must be more than 0");
  const method = ["cash", "card", "payroll", "writeoff"].includes(req.body?.method) ? req.body.method : null;
  if (!method) throw new HttpError(400, "Pick a method");
  if (method === "writeoff" && req.user.role !== "admin") throw new HttpError(403, "Only an admin can write off");
  db.prepare("INSERT INTO tab_payments(tab_name, amount, method, note, user_id, created_at, local_day) VALUES(?,?,?,?,?,?,?)")
    .run(cleanText(req.params.name, 60), amount, method, cleanText(req.body?.note, 200), req.user.id, nowIso(), localParts().day);
  io.to("staff").emit("tabs-changed");
  res.json({ ok: true });
});

// ── Rewards (staff-only employee points) ─────────────────────────
app.get("/api/rewards", staff, (_req, res) => res.json({ config: rewardConfig(), balances: rewardBalances() }));
app.get("/api/rewards/balance", staff, (req, res) => {
  const name = cleanText(req.query.name, 60);
  const points = balanceOf(name);
  res.json({ name, points, value: pointsValue(points) });
});
app.get("/api/rewards/:name", staff, (req, res) => res.json(rewardHistory(req.params.name)));
app.post("/api/rewards/:name/adjust", admin, (req, res) => {
  const r = adjustPoints(req.params.name, req.body?.points, req.body?.note, req.user.id);
  io.to("staff").emit("rewards-changed");
  res.json(r);
});

// ── People (employees for autocomplete + tabs) ────────────────────
app.get("/api/people", staff, (_req, res) => res.json(db.prepare("SELECT * FROM people ORDER BY name").all()));
app.post("/api/people", staff, (req, res) => {
  const name = cleanText(req.body?.name, 60);
  if (!name) throw new HttpError(400, "Name required");
  upsertPerson(name);
  db.prepare("UPDATE people SET active = 1 WHERE name = ?").run(name);
  res.json({ ok: true });
});
// Every name used anywhere (employee list, orders, tabs), with how often.
app.get("/api/people/names", admin, (_req, res) => res.json(allNames()));
// Likely duplicates for the weekly clean-up.
app.get("/api/people/duplicates", admin, (_req, res) => res.json(duplicateGroups()));
// Merge names into one: orders, tab charges and tab payments move to the kept name.
app.post("/api/people/merge", admin, (req, res) => {
  const r = mergeNames(req.body?.into, req.body?.from);
  io.to("staff").emit("tabs-changed");
  res.json(r);
});
// "Not the same person": hide this group from duplicate suggestions.
app.post("/api/people/ignore", admin, (req, res) => res.json(ignorePair(req.body?.names)));

app.patch("/api/people/:id", admin, (req, res) => {
  const p = db.prepare("SELECT * FROM people WHERE id = ?").get(int(req.params.id));
  if (!p) throw new HttpError(404, "Not found");
  const name = req.body?.name !== undefined ? cleanText(req.body.name, 60) || p.name : p.name;
  const active = req.body?.active !== undefined ? bool(req.body.active) : p.active;
  db.prepare("UPDATE people SET name = ?, active = ? WHERE id = ?").run(name, active, p.id);
  res.json({ ok: true });
});
app.delete("/api/people/:id", admin, (req, res) => {
  db.prepare("DELETE FROM people WHERE id = ?").run(int(req.params.id));
  res.json({ ok: true });
});

// ── Rooms ─────────────────────────────────────────────────────────
app.get("/api/rooms", staff, (_req, res) => res.json(db.prepare("SELECT * FROM rooms ORDER BY sort, name").all()));
app.post("/api/rooms", admin, (req, res) => {
  const name = cleanText(req.body?.name, 60);
  if (!name) throw new HttpError(400, "Name required");
  let slug = slugify(req.body?.slug || name);
  while (roomBySlug(slug)) slug = `${slug}-${crypto.randomBytes(1).toString("hex")}`;
  const sort = (db.prepare("SELECT MAX(sort) AS m FROM rooms").get().m ?? -1) + 1;
  db.prepare("INSERT INTO rooms(name, slug, code, sort) VALUES(?,?,?,?)").run(name, slug, newCode(), sort);
  res.json(roomBySlug(slug));
});
app.patch("/api/rooms/:id", admin, (req, res) => {
  const r = db.prepare("SELECT * FROM rooms WHERE id = ?").get(int(req.params.id));
  if (!r) throw new HttpError(404, "Not found");
  const b = req.body || {};
  const code = b.code !== undefined ? cleanText(b.code, 12).toUpperCase() : r.code;
  if (!code) throw new HttpError(400, "Code required");
  db.prepare(`UPDATE rooms SET name=?, active=?, sort=?, code=?,
      code_changed_at = CASE WHEN code != ? THEN ? ELSE code_changed_at END WHERE id=?`).run(
    b.name !== undefined ? cleanText(b.name, 60) || r.name : r.name,
    b.active !== undefined ? bool(b.active) : r.active,
    b.sort !== undefined ? int(b.sort) : r.sort,
    code, code, nowIso(), r.id,
  );
  res.json(db.prepare("SELECT * FROM rooms WHERE id = ?").get(r.id));
});
app.post("/api/rooms/:id/rotate", admin, (req, res) => {
  db.prepare("UPDATE rooms SET code = ?, code_changed_at = ? WHERE id = ?").run(newCode(), nowIso(), int(req.params.id));
  res.json(db.prepare("SELECT * FROM rooms WHERE id = ?").get(int(req.params.id)));
});
app.post("/api/rooms/rotate-all", admin, (_req, res) => {
  tx(() => {
    for (const r of db.prepare("SELECT id FROM rooms").all()) {
      db.prepare("UPDATE rooms SET code = ?, code_changed_at = ? WHERE id = ?").run(newCode(), nowIso(), r.id);
    }
  });
  res.json(db.prepare("SELECT * FROM rooms ORDER BY sort, name").all());
});
app.delete("/api/rooms/:id", admin, (req, res) => {
  const id = int(req.params.id);
  const used = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE room_id = ?").get(id).n;
  if (used) db.prepare("UPDATE rooms SET active = 0 WHERE id = ?").run(id);
  else db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
  res.json({ ok: true, deactivated: !!used });
});
function baseUrl(req) {
  const s = getSettings().publicUrl.trim().replace(/\/+$/, "");
  return s || `${req.protocol}://${req.get("host")}`;
}
app.get("/api/rooms/:id/qr.svg", staff, async (req, res) => {
  const r = db.prepare("SELECT * FROM rooms WHERE id = ?").get(int(req.params.id));
  if (!r) throw new HttpError(404, "Not found");
  const svg = await QRCode.toString(`${baseUrl(req)}/r/${r.slug}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  res.type("image/svg+xml").send(svg);
});
app.get("/api/base-url", staff, (req, res) => res.json({ url: baseUrl(req) }));

// ── Team (staff logins) ───────────────────────────────────────────
function pinTaken(pin, exceptId) {
  return db.prepare("SELECT id, pin_hash FROM users WHERE active = 1").all()
    .some((u) => u.id !== exceptId && checkPin(pin, u.pin_hash));
}
app.get("/api/users", admin, (_req, res) => {
  res.json(db.prepare("SELECT id, name, role, active, created_at FROM users ORDER BY active DESC, name").all());
});
app.post("/api/users", admin, (req, res) => {
  const name = cleanText(req.body?.name, 60);
  const pin = String(req.body?.pin ?? "");
  const role = req.body?.role === "admin" ? "admin" : "staff";
  if (!name) throw new HttpError(400, "Name required");
  if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, "PIN is 4-8 digits");
  if (pinTaken(pin)) throw new HttpError(409, "That PIN is already used");
  db.prepare("INSERT INTO users(name, pin_hash, role) VALUES(?,?,?)").run(name, hashPin(pin), role);
  res.json({ ok: true });
});
app.patch("/api/users/:id", admin, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(int(req.params.id));
  if (!u) throw new HttpError(404, "Not found");
  const b = req.body || {};
  const role = b.role !== undefined ? (b.role === "admin" ? "admin" : "staff") : u.role;
  const active = b.active !== undefined ? bool(b.active) : u.active;
  if (u.role === "admin" && (role !== "admin" || !active)) {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND id != ?").get(u.id).n;
    if (!admins) throw new HttpError(409, "Keep at least one active admin");
  }
  let pinHash = u.pin_hash;
  if (b.pin) {
    if (!/^\d{4,8}$/.test(String(b.pin))) throw new HttpError(400, "PIN is 4-8 digits");
    if (pinTaken(String(b.pin), u.id)) throw new HttpError(409, "That PIN is already used");
    pinHash = hashPin(String(b.pin));
  }
  db.prepare("UPDATE users SET name=?, role=?, active=?, pin_hash=? WHERE id=?")
    .run(b.name !== undefined ? cleanText(b.name, 60) || u.name : u.name, role, active, pinHash, u.id);
  res.json({ ok: true });
});

// ── Settings ──────────────────────────────────────────────────────
app.get("/api/settings", staff, (_req, res) => res.json(getSettings()));
app.put("/api/settings", admin, (req, res) => {
  const b = { ...(req.body || {}) };
  if ("rewardsEnabled" in b) b.rewardsEnabled = b.rewardsEnabled === "1" || b.rewardsEnabled === true ? "1" : "0";
  if ("rewardEarnPerSar" in b) {
    const n = Number(b.rewardEarnPerSar);
    if (!(n >= 0 && n <= 100)) throw new HttpError(400, "Points per SAR must be 0-100");
    b.rewardEarnPerSar = String(n);
  }
  if ("rewardPointsPerSar" in b) {
    const n = Math.trunc(Number(b.rewardPointsPerSar));
    if (!(n >= 1 && n <= 10000)) throw new HttpError(400, "Points for SAR 1 must be 1-10000");
    b.rewardPointsPerSar = String(n);
  }
  const s = setSettings(b);
  io.emit("settings-changed");
  res.json(s);
});
// Any staff can open/close room ordering from the board.
app.post("/api/settings/room-ordering", staff, (req, res) => {
  const s = setSettings({ roomOrdering: req.body?.open ? "open" : "closed" });
  io.emit("settings-changed");
  res.json(s);
});

// ── Reports ───────────────────────────────────────────────────────
function range(req) {
  const today = localParts().day;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = re.test(String(req.query.from)) ? String(req.query.from) : today;
  const to = re.test(String(req.query.to)) ? String(req.query.to) : from;
  return from <= to ? [from, to] : [to, from];
}
app.get("/api/reports/summary", staff, (req, res) => res.json(summary(...range(req))));
app.get("/api/reports/items.csv", staff, (req, res) => {
  const [f, t] = range(req);
  res.attachment(`items_${f}_${t}.csv`).type("text/csv").send(itemsCsv(f, t));
});
app.get("/api/reports/orders.csv", staff, (req, res) => {
  const [f, t] = range(req);
  res.attachment(`orders_${f}_${t}.csv`).type("text/csv").send(ordersCsv(f, t));
});
// Health check for Docker / uptime monitors (no auth, no data).
app.get("/api/health", (_req, res) => {
  db.prepare("SELECT 1").get();
  res.json({ ok: true, version: VERSION });
});
app.get("/api/today", staff, (_req, res) => res.json({ day: localParts().day }));

// Backup: download the raw SQLite file (admin).
app.get("/api/backup", admin, (_req, res) => {
  const file = path.join(process.env.DATA_DIR || path.resolve("data"), `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  res.download(file, `twisted-cafe-${localParts().day}.db`, () => fs.rm(file, () => {}));
});

// Import a POS2 tenant export (JSON from tenant-data-export.zip).
app.post("/api/import/pos2", admin, (req, res) => {
  let r;
  try {
    r = importPos2(req.body, { orders: req.query.orders !== "0", replaceMenu: req.query.keepMenu !== "1" });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  emitMenu();
  io.emit("settings-changed");
  res.json(r);
});

// ── Discount codes ────────────────────────────────────────────────
function discountLabel(c) {
  return c.kind === "percent" ? `${c.value}% off` : `SAR ${(c.value / 100).toFixed(2).replace(/\.00$/, "")} off`;
}
function discountPreview(code, lines, source, customerName) {
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const d = evaluateDiscount(code, { subtotal, source, customerName });
  return { code: d.code.code, label: discountLabel(d.code), amount: d.amount, subtotal, total: subtotal - d.amount };
}
// Room customers preview a code before ordering (needs the room code, like ordering does).
app.post("/api/public/discount", (req, res) => {
  if (!discountLimit(req.ip)) throw new HttpError(429, "Too many tries. Wait 10 minutes.");
  const b = req.body || {};
  const r = roomBySlug(b.room);
  if (!r || !r.active) throw new HttpError(404, "Room not found");
  if (!sameCode(b.code, r.code)) throw new HttpError(403, "Room code changed. Enter the new code from the card.");
  res.json(discountPreview(b.discountCode, buildLines(b.items, { forRoom: true }), "room", b.name));
});
app.post("/api/discounts/check", staff, (req, res) => {
  const b = req.body || {};
  res.json(discountPreview(b.code, buildLines(b.items), b.roomId ? "room" : "counter", b.customerName));
});

function discountFromBody(b, base = {}) {
  const pick = (k, f) => (b[k] !== undefined ? f(b[k]) : base[k]);
  const day = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
  const optMoney = (v) => (v === null || v === "" ? null : money(v));
  const optInt = (v) => (v === null || v === "" ? null : Math.max(1, int(v)));
  const d = {
    code: pick("code", (v) => cleanText(v, 40).toUpperCase().replace(/\s+/g, "")),
    kind: pick("kind", (v) => (v === "amount" ? "amount" : "percent")) ?? "percent",
    value: pick("value", (v) => Math.max(0, int(v))),
    max_discount: pick("max_discount", optMoney) ?? null,
    min_order: pick("min_order", (v) => money(v || 0)) ?? 0,
    scope: pick("scope", (v) => (["counter", "room"].includes(v) ? v : "all")) ?? "all",
    starts_on: pick("starts_on", day) ?? null,
    ends_on: pick("ends_on", day) ?? null,
    max_uses: pick("max_uses", optInt) ?? null,
    once_per_person: pick("once_per_person", bool) ?? 0,
    active: pick("active", bool) ?? 1,
    note: pick("note", (v) => cleanText(v, 200)) ?? "",
  };
  if (!d.code || !/^[A-Z0-9_-]{2,40}$/.test(d.code)) throw new HttpError(400, "Code: 2-40 letters, numbers, - or _");
  if (d.kind === "percent" && !(d.value >= 1 && d.value <= 100)) throw new HttpError(400, "Percent must be 1-100");
  if (d.kind === "amount" && !(d.value >= 1)) throw new HttpError(400, "Amount must be more than 0");
  if (d.starts_on && d.ends_on && d.starts_on > d.ends_on) throw new HttpError(400, "End date is before start date");
  return d;
}
const DISCOUNT_COLS = ["code", "kind", "value", "max_discount", "min_order", "scope", "starts_on", "ends_on", "max_uses", "once_per_person", "active", "note"];
app.get("/api/discounts", admin, (_req, res) => {
  res.json(db.prepare(`SELECT d.*,
      (SELECT COUNT(*) FROM orders o WHERE o.discount_code = d.code COLLATE NOCASE AND o.status != 'cancelled') AS uses,
      (SELECT COALESCE(SUM(o.discount), 0) FROM orders o WHERE o.discount_code = d.code COLLATE NOCASE AND o.status != 'cancelled') AS given
    FROM discount_codes d WHERE d.deleted = 0 ORDER BY d.active DESC, d.id DESC`).all());
});
app.post("/api/discounts", admin, (req, res) => {
  const d = discountFromBody(req.body || {});
  const clash = db.prepare("SELECT id, deleted FROM discount_codes WHERE code = ?").get(d.code);
  if (clash && !clash.deleted) throw new HttpError(409, "That code already exists");
  if (clash) db.prepare("DELETE FROM discount_codes WHERE id = ?").run(clash.id); // reuse a deleted code's name
  const id = db.prepare(`INSERT INTO discount_codes(${DISCOUNT_COLS.join(",")}) VALUES(${DISCOUNT_COLS.map(() => "?").join(",")})`)
    .run(...DISCOUNT_COLS.map((k) => d[k])).lastInsertRowid;
  res.json(db.prepare("SELECT * FROM discount_codes WHERE id = ?").get(id));
});
app.patch("/api/discounts/:id", admin, (req, res) => {
  const base = db.prepare("SELECT * FROM discount_codes WHERE id = ? AND deleted = 0").get(int(req.params.id));
  if (!base) throw new HttpError(404, "Not found");
  const d = discountFromBody(req.body || {}, base);
  if (d.code !== base.code) {
    const used = db.prepare("SELECT 1 FROM orders WHERE discount_code = ? COLLATE NOCASE LIMIT 1").get(base.code);
    if (used) throw new HttpError(409, "This code has been used, so it can't be renamed. Make a new code instead.");
    if (db.prepare("SELECT 1 FROM discount_codes WHERE code = ? AND id != ? AND deleted = 0").get(d.code, base.id)) throw new HttpError(409, "That code already exists");
  }
  db.prepare(`UPDATE discount_codes SET ${DISCOUNT_COLS.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...DISCOUNT_COLS.map((k) => d[k]), base.id);
  res.json(db.prepare("SELECT * FROM discount_codes WHERE id = ?").get(base.id));
});
app.delete("/api/discounts/:id", admin, (req, res) => {
  db.prepare("UPDATE discount_codes SET deleted = 1, active = 0 WHERE id = ?").run(int(req.params.id));
  res.json({ ok: true });
});

// ── Activity log ──────────────────────────────────────────────────
app.get("/api/logs", admin, (req, res) => {
  const where = [];
  const args = [];
  if (/^d{4}-d{2}-d{2}$/.test(String(req.query.day || ""))) { where.push("local_day = ?"); args.push(String(req.query.day)); }
  if (req.query.category) { where.push("category = ?"); args.push(String(req.query.category)); }
  if (req.query.failed === "1") where.push("ok = 0");
  if (req.query.q) { where.push("(message LIKE ? OR actor LIKE ?)"); const q = `%${String(req.query.q).slice(0, 60)}%`; args.push(q, q); }
  if (req.query.before) { where.push("id < ?"); args.push(int(req.query.before)); }
  const limit = Math.min(500, Math.max(1, int(req.query.limit) || 100));
  const rows = db.prepare(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`).all(...args, limit);
  res.json(rows);
});

app.use("/api", (_req, _res) => {
  throw new HttpError(404, "Not found");
});

// ── Static web app ────────────────────────────────────────────────
const dist = path.resolve("web/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === "entity.parse.failed" ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Server error" : err.message });
});

// ── Realtime ──────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const data = readToken(parseCookies(socket.handshake.headers.cookie)[COOKIE_NAME]);
  const user = data && db.prepare("SELECT id FROM users WHERE id = ? AND active = 1").get(data.uid);
  if (user) socket.join("staff");
  if (user && db.prepare("SELECT role FROM users WHERE id = ?").get(user.id)?.role === "admin") socket.join("admins");
  socket.on("watch", (token) => {
    if (typeof token === "string" && token.length < 40) socket.join(`o:${token}`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Twisted Cafe v${VERSION} running on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`  Counter / staff: http://localhost:${PORT}/staff`);
});

// Clean shutdown (docker stop / systemctl stop): finish requests, close sockets, close the database.
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig} received, shutting down…`);
    io.close();
    server.close(() => {
      try { db.close(); } catch { /* already closed */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
