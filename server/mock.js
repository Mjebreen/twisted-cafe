// Mock data for demos/testing. Everything it creates is recorded in mock_rows so it can be removed cleanly.
//   node server/mock.js           add 30 days of orders + live orders today + staff + employees + tabs
//   node server/mock.js --clear   remove every mock row (real data is never touched)
import crypto from "node:crypto";
import { db, tx, getSettings } from "./db.js";
import { hashPin } from "./auth.js";
import { localParts, parseOptions } from "./orders.js";

db.exec("CREATE TABLE IF NOT EXISTS mock_rows (kind TEXT NOT NULL, ref_id INTEGER NOT NULL)");
const track = (kind, id) => db.prepare("INSERT INTO mock_rows(kind, ref_id) VALUES(?, ?)").run(kind, Number(id));

function clear() {
  const ids = (kind) => db.prepare("SELECT ref_id FROM mock_rows WHERE kind = ?").all(kind).map((r) => r.ref_id);
  const del = (table, list) => {
    for (const id of list) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return list.length;
  };
  const r = tx(() => {
    const orders = ids("order");
    for (const id of orders) db.prepare("DELETE FROM order_items WHERE order_id = ?").run(id);
    const out = {
      orders: del("orders", orders),
      tabPayments: del("tab_payments", ids("tab_payment")),
      people: del("people", ids("person")),
      rooms: 0,
      users: 0,
    };
    // Mock users/rooms may be referenced by real orders made since; deactivate those instead of deleting.
    for (const id of ids("user")) {
      const used = db.prepare("SELECT 1 FROM orders WHERE created_by = ? OR paid_by = ? LIMIT 1").get(id, id);
      if (used) db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(id);
      else db.prepare("DELETE FROM users WHERE id = ?").run(id);
      out.users++;
    }
    for (const id of ids("room")) {
      const used = db.prepare("SELECT 1 FROM orders WHERE room_id = ? LIMIT 1").get(id);
      if (used) db.prepare("UPDATE rooms SET active = 0 WHERE id = ?").run(id);
      else db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
      out.rooms++;
    }
    db.exec("DELETE FROM mock_rows");
    return out;
  });
  console.log("Removed mock data:", r);
}

// Deterministic random so repeated runs look similar.
let seed = 20261024;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let x = rand() * total;
  for (const [v, w] of pairs) if ((x -= w) <= 0) return v;
  return pairs[0][0];
};

const EMPLOYEES = [
  "Abdullah Alqahtani", "Faisal Alharbi", "Reem Alotaibi", "Nawaf Alshehri", "Lama Aldosari", "Turki Almutairi",
  "Sara Alghamdi", "Khalid Alzahrani", "Hessa Alanazi", "Omar Alsubaie", "Joud Alrashid", "Yazeed Alshammari",
  "Maha Alsaud", "Bader Alenezi", "Rakan Albalawi", "Dana Alharthi", "Saad Alqahtani", "Noor Almalki",
  "Ziyad Alamri", "Layan Alyami",
];
const STAFF = [["Saud", "1111"], ["Noura", "2222"], ["Majed", "3333"]];
const ROOM_NOTES = ["", "", "", "", "Extra hot please", "Less ice", "Bring napkins", "Two straws", "In 10 minutes please"];

function add() {
  const already = db.prepare("SELECT COUNT(*) AS n FROM mock_rows WHERE kind = 'order'").get().n;
  if (already) {
    console.log(`Mock data already loaded (${already} orders). Run with --clear first to regenerate.`);
    return;
  }
  const tz = getSettings().timezone;
  const items = db.prepare(`SELECT i.*, c.name AS category_name FROM items i JOIN categories c ON c.id = i.category_id
    WHERE i.deleted = 0`).all().map((i) => ({ ...i, options: parseOptions(i.options) }));
  if (!items.length) throw new Error("No menu items. Import or add a menu first.");

  const report = tx(() => {
    // Staff logins (skip if the PIN is taken).
    const users = db.prepare("SELECT id FROM users WHERE active = 1").all().map((u) => u.id);
    for (const [name, pin] of STAFF) {
      if (db.prepare("SELECT 1 FROM users WHERE name = ?").get(name)) continue;
      const id = db.prepare("INSERT INTO users(name, pin_hash, role) VALUES(?, ?, 'staff')").run(name, hashPin(pin)).lastInsertRowid;
      track("user", id);
      users.push(Number(id));
    }
    // Employees.
    for (const name of EMPLOYEES) {
      const r = db.prepare("INSERT INTO people(name) VALUES(?) ON CONFLICT(name) DO NOTHING").run(name);
      if (r.changes) track("person", db.prepare("SELECT id FROM people WHERE name = ?").get(name).id);
    }
    // Rooms: use existing ones; add a few if there are none.
    let rooms = db.prepare("SELECT * FROM rooms WHERE active = 1").all();
    if (!rooms.length) {
      for (const [n, s] of [["Meeting Room A", "meeting-room-a"], ["Practice 1", "practice-1"], ["Shared Office", "shared-office"]]) {
        const id = db.prepare("INSERT INTO rooms(name, slug, code) VALUES(?,?,?)").run(n, s, String(crypto.randomInt(1000, 10000))).lastInsertRowid;
        track("room", id);
      }
      rooms = db.prepare("SELECT * FROM rooms WHERE active = 1").all();
    }

    // Popularity: coffee of the day + iced drinks sell most (matches the POS2 history).
    const itemWeight = (i) => (/iced|ice /i.test(i.name) ? 3 : 1) * (/day|v60/i.test(i.name) ? 2 : 1) * (/water/i.test(i.name) ? 1.5 : 1);
    const itemPairs = items.map((i) => [i, itemWeight(i)]);
    const roomPairs = rooms.map((r) => [r, /shared|office/i.test(r.name) ? 3 : /meeting/i.test(r.name) ? 2 : 1]);

    let orders = 0, lines = 0;
    const insertOrder = (created, opts) => {
      const { day, hour } = localParts(created, tz);
      const number = (db.prepare("SELECT MAX(number) AS m FROM orders WHERE local_day = ?").get(day).m || 0) + 1;
      const n = weighted([[1, 6], [2, 3], [3, 1]]);
      const chosen = Array.from({ length: n }, () => weighted(itemPairs));
      const built = chosen.map((it) => {
        const labels = [];
        let extra = 0;
        it.options.forEach((g) => {
          if (g.required || rand() < 0.4) {
            const c = pick(g.choices);
            labels.push(c.name);
            extra += c.price || 0;
          }
        });
        const qty = rand() < 0.15 ? 2 : 1;
        return { it, qty, unit: it.price + extra, labels: labels.join(", ") };
      });
      const total = built.reduce((s, b) => s + b.unit * b.qty, 0);
      const iso = created.toISOString();
      const at = (min) => new Date(created.getTime() + min * 60_000).toISOString();
      const room = opts.source === "room" ? opts.room : null;
      const pay = opts.payment;
      const id = db.prepare(`INSERT INTO orders(number, local_day, local_hour, token, source, room_id, room_name, customer_name, note,
          status, pay_pref, payment_status, payment_method, tab_name, total, cancel_reason, created_by, paid_by,
          created_at, updated_at, ready_at, completed_at, paid_at, external_ref)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        number, day, hour, crypto.randomBytes(12).toString("base64url"), opts.source, room?.id ?? null, room?.name ?? null,
        opts.customer, opts.note || "", opts.status, opts.payPref ?? null, pay ? "paid" : "unpaid", pay?.method ?? null,
        pay?.method === "tab" ? opts.customer : null, total, opts.status === "cancelled" ? "Customer changed their mind" : null,
        opts.source === "counter" ? opts.user : null, pay ? opts.user : null, iso, iso,
        ["ready", "completed"].includes(opts.status) ? at(opts.prep) : null,
        opts.status === "completed" ? at(opts.prep + 3) : null, pay ? at(opts.prep + 3) : null, "mock",
      ).lastInsertRowid;
      track("order", id);
      for (const b of built) {
        db.prepare(`INSERT INTO order_items(order_id, item_id, name, category_name, qty, unit_price, options_text, note, line_total)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(id, b.it.id, b.it.name, b.it.category_name, b.qty, b.unit, b.labels, "", b.unit * b.qty);
        lines++;
      }
      orders++;
    };

    // Riyadh is UTC+3 all year: local 17:30 → 14:30 UTC.
    const today = localParts(new Date(), tz).day;
    const now = Date.now();
    for (let back = 30; back >= 0; back--) {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - back);
      const dayStr = d.toISOString().slice(0, 10);
      const weekday = d.getUTCDay(); // 5 = Fri, 6 = Sat
      const count = back === 0 ? 14 : Math.round((weekday === 5 || weekday === 6 ? 18 : 30) * (0.7 + rand() * 0.6));
      for (let k = 0; k < count; k++) {
        // Evening-heavy: most orders between 18:00 and 23:00 local.
        const localMin = weighted([[17, 1], [18, 2], [19, 3], [20, 4], [21, 4], [22, 3], [23, 2]]) * 60 + Math.floor(rand() * 60);
        const created = new Date(Date.parse(`${dayStr}T00:00:00Z`) + (localMin - 180) * 60_000);
        if (created.getTime() > now - 2 * 60_000) continue; // nothing in the future
        const source = rand() < 0.55 ? "room" : "counter";
        const customer = source === "room" || rand() < 0.4 ? pick(EMPLOYEES) : "";
        const method = weighted([["card", 60], ["cash", 15], ["tab", source === "room" || customer ? 20 : 0], ["free", 5]]);
        const ageMin = (now - created.getTime()) / 60_000;
        // Today's most recent orders stay live on the board.
        let status = "completed";
        if (back === 0 && ageMin < 8) status = "new";
        else if (back === 0 && ageMin < 14) status = "preparing";
        else if (back === 0 && ageMin < 20) status = "ready";
        else if (rand() < 0.03) status = "cancelled";
        const live = status !== "completed";
        const payNow = status === "cancelled" ? false : source === "counter" ? true : !live && rand() > 0.03;
        insertOrder(created, {
          source, room: source === "room" ? weighted(roomPairs) : null, customer, status,
          note: source === "room" ? pick(ROOM_NOTES) : "",
          payPref: source === "room" ? (method === "free" ? "card" : method) : null,
          payment: payNow ? { method: method === "tab" && !customer ? "card" : method } : null,
          user: pick(users), prep: 3 + Math.floor(rand() * 9),
        });
      }
    }

    // Some tab settlements.
    const tabs = db.prepare(`SELECT tab_name AS name, SUM(total) AS t FROM orders WHERE payment_method = 'tab' AND external_ref = 'mock'
      GROUP BY tab_name`).all();
    let payments = 0;
    for (const t of tabs) {
      if (rand() < 0.5) continue;
      const amount = Math.round((t.t * (0.5 + rand() * 0.5)) / 100) * 100;
      const created = new Date(now - Math.floor(rand() * 20) * 86_400_000);
      const id = db.prepare(`INSERT INTO tab_payments(tab_name, amount, method, note, user_id, created_at, local_day)
        VALUES(?,?,?,?,?,?,?)`).run(t.name, amount, pick(["cash", "card", "payroll"]), "Mock settlement", pick(users),
        created.toISOString(), localParts(created, tz).day).lastInsertRowid;
      track("tab_payment", id);
      payments++;
    }
    return { orders, lines, tabPayments: payments, staff: STAFF.map(([n, p]) => `${n} (PIN ${p})`).join(", ") };
  });
  console.log("Added mock data:", report);
  console.log("Remove it any time with: npm run mock:clear");
}

if (process.argv.includes("--clear")) clear();
else add();
