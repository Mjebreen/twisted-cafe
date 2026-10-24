// Order creation, status changes, payments, and read helpers.
import crypto from "node:crypto";
import { db, getSettings, tx } from "./db.js";

export const STATUSES = ["new", "preparing", "ready", "completed", "cancelled"];
export const PAY_METHODS = ["cash", "card", "tab", "free"];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

// Local day + hour in the cafe timezone, so "today" means the cafe's today.
export function localParts(date = new Date(), tz = getSettings().timezone) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

export function cleanText(v, max = 200) {
  return String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

export function parseOptions(json) {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Turn cart input into priced lines. Prices always come from the DB, never the client.
 * input: [{ itemId, qty, options: [{ g, c }], note }]
 */
export function buildLines(input, { forRoom = false } = {}) {
  if (!Array.isArray(input) || input.length === 0) throw new HttpError(400, "Cart is empty");
  if (input.length > 50) throw new HttpError(400, "Too many lines");
  const getItem = db.prepare(
    "SELECT i.*, c.name AS category_name FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ? AND i.deleted = 0",
  );
  return input.map((line) => {
    const item = getItem.get(Number(line.itemId));
    if (!item) throw new HttpError(400, "An item in the cart no longer exists");
    if (!item.available) throw new HttpError(409, `${item.name} is sold out`);
    if (forRoom && !item.room_orderable) throw new HttpError(409, `${item.name} is counter only`);
    const qty = Math.trunc(Number(line.qty));
    if (!(qty >= 1 && qty <= 50)) throw new HttpError(400, "Bad quantity");

    const groups = parseOptions(item.options);
    const picked = Array.isArray(line.options) ? line.options : [];
    let extra = 0;
    const labels = [];
    groups.forEach((g, gi) => {
      const mine = picked.filter((p) => Number(p.g) === gi);
      if (g.type !== "multi" && mine.length > 1) throw new HttpError(400, `Pick one ${g.name}`);
      if (g.required && mine.length === 0) throw new HttpError(400, `${item.name}: choose ${g.name}`);
      for (const p of mine) {
        const ch = g.choices?.[Number(p.c)];
        if (!ch) throw new HttpError(400, "Bad option");
        extra += Math.trunc(Number(ch.price) || 0);
        labels.push(ch.name);
      }
    });
    const unit = item.price + extra;
    return {
      item_id: item.id,
      name: item.name,
      category_name: item.category_name,
      qty,
      unit_price: unit,
      options_text: labels.join(", "),
      note: cleanText(line.note, 120),
      line_total: unit * qty,
    };
  });
}

export function upsertPerson(name) {
  const n = cleanText(name, 60);
  if (n) db.prepare("INSERT INTO people(name) VALUES(?) ON CONFLICT(name) DO NOTHING").run(n);
}

export function createOrder({ source, room, customerName, note, lines, payPref, payment, status, userId, discountCode }) {
  return tx(() => {
    const now = new Date();
    const { day, hour } = localParts(now);
    const number =
      (db.prepare("SELECT MAX(number) AS m FROM orders WHERE local_day = ?").get(day).m || 0) + 1;
    const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
    const d = discountCode ? evaluateDiscount(discountCode, { subtotal, source, customerName }) : null;
    const discount = d?.amount ?? 0;
    const total = subtotal - discount;
    const iso = now.toISOString();
    const token = crypto.randomBytes(12).toString("base64url");
    const id = db.prepare(`
      INSERT INTO orders(number, local_day, local_hour, token, source, room_id, room_name, customer_name, note,
        status, pay_pref, total, subtotal, discount, discount_code, created_by, created_at, updated_at, completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      number, day, hour, token, source, room?.id ?? null, room?.name ?? null,
      cleanText(customerName, 60), cleanText(note, 300), status || "new", payPref || null, total, subtotal, discount,
      d?.code.code ?? null, userId ?? null, iso, iso, status === "completed" ? iso : null,
    ).lastInsertRowid;
    const ins = db.prepare(`INSERT INTO order_items(order_id, item_id, name, category_name, qty, unit_price,
      options_text, note, line_total) VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const l of lines) {
      ins.run(id, l.item_id, l.name, l.category_name, l.qty, l.unit_price, l.options_text, l.note, l.line_total);
    }
    if (customerName && source === "room") upsertPerson(customerName);
    if (payment) applyPayment(Number(id), payment.method, payment.tabName, userId);
    return Number(id);
  });
}

/**
 * Check a discount code against an order and return { code, amount } in halalas.
 * Throws an HttpError with a short, customer-safe message when the code can't be used.
 */
export function evaluateDiscount(rawCode, { subtotal, source, customerName = "" }) {
  const codeStr = cleanText(rawCode, 40);
  const code = db.prepare("SELECT * FROM discount_codes WHERE code = ? AND deleted = 0").get(codeStr);
  if (!code || !code.active) throw new HttpError(404, "This discount code is not valid");
  const today = localParts().day;
  if (code.starts_on && today < code.starts_on) throw new HttpError(409, "This discount code is not active yet");
  if (code.ends_on && today > code.ends_on) throw new HttpError(409, "This discount code has expired");
  if (code.scope === "counter" && source !== "counter") throw new HttpError(409, "This code only works at the counter");
  if (code.scope === "room" && source !== "room") throw new HttpError(409, "This code only works for room orders");
  if (subtotal < code.min_order) {
    throw new HttpError(409, `Minimum order for this code is SAR ${(code.min_order / 100).toFixed(2).replace(/\.00$/, "")}`);
  }
  if (code.max_uses != null) {
    const used = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE discount_code = ? COLLATE NOCASE AND status != 'cancelled'").get(code.code).n;
    if (used >= code.max_uses) throw new HttpError(409, "This discount code has been used up");
  }
  if (code.once_per_person) {
    const who = cleanText(customerName, 60);
    if (!who) throw new HttpError(409, "Enter a name to use this code");
    const used = db.prepare(`SELECT 1 FROM orders WHERE discount_code = ? COLLATE NOCASE AND status != 'cancelled'
      AND customer_name = ? COLLATE NOCASE LIMIT 1`).get(code.code, who);
    if (used) throw new HttpError(409, "You have already used this code");
  }
  let amount = code.kind === "percent" ? Math.round((subtotal * code.value) / 100) : code.value;
  if (code.kind === "percent" && code.max_discount != null) amount = Math.min(amount, code.max_discount);
  amount = Math.max(0, Math.min(amount, subtotal));
  return { code, amount };
}

function applyPayment(id, method, tabName, userId) {
  if (!PAY_METHODS.includes(method)) throw new HttpError(400, "Bad payment method");
  let tab = null;
  if (method === "tab") {
    tab = cleanText(tabName, 60);
    if (!tab) throw new HttpError(400, "Tab needs a name");
    upsertPerson(tab);
  }
  const iso = nowIso();
  db.prepare(`UPDATE orders SET payment_status='paid', payment_method=?, tab_name=?, paid_at=?, paid_by=?, updated_at=?
    WHERE id=?`).run(method, tab, iso, userId ?? null, iso, id);
}

export function payOrder(id, method, tabName, userId) {
  const o = getOrderRow(id);
  if (o.status === "cancelled") throw new HttpError(409, "Order is cancelled");
  if (o.payment_status === "paid") throw new HttpError(409, "Order already paid");
  applyPayment(id, method, tabName, userId);
}

export function unpayOrder(id) {
  getOrderRow(id);
  db.prepare(`UPDATE orders SET payment_status='unpaid', payment_method=NULL, tab_name=NULL, paid_at=NULL, paid_by=NULL,
    updated_at=? WHERE id=?`).run(nowIso(), id);
}

export function setStatus(id, status, reason) {
  if (!STATUSES.includes(status)) throw new HttpError(400, "Bad status");
  const o = getOrderRow(id);
  if (o.status === "cancelled") throw new HttpError(409, "Order is cancelled");
  const iso = nowIso();
  db.prepare(`UPDATE orders SET status=?, updated_at=?,
      ready_at = CASE WHEN ?='ready' AND ready_at IS NULL THEN ? ELSE ready_at END,
      completed_at = CASE WHEN ?='completed' THEN ? ELSE completed_at END,
      cancel_reason = CASE WHEN ?='cancelled' THEN ? ELSE cancel_reason END
    WHERE id=?`).run(status, iso, status, iso, status, iso, status, cleanText(reason, 200) || null, id);
}

function getOrderRow(id) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(id));
  if (!o) throw new HttpError(404, "Order not found");
  return o;
}

const ORDER_SELECT = `SELECT o.*, cu.name AS created_by_name, pu.name AS paid_by_name, rm.slug AS room_slug
  FROM orders o LEFT JOIN users cu ON cu.id = o.created_by LEFT JOIN users pu ON pu.id = o.paid_by
  LEFT JOIN rooms rm ON rm.id = o.room_id`;

function attachItems(orders) {
  if (orders.length === 0) return orders;
  const ids = orders.map((o) => o.id);
  const rows = db.prepare(
    `SELECT * FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
  ).all(...ids);
  const by = new Map(ids.map((id) => [id, []]));
  for (const r of rows) by.get(r.order_id).push(r);
  return orders.map((o) => ({ ...o, items: by.get(o.id) }));
}

export function getOrder(id) {
  const o = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(Number(id));
  return o ? attachItems([o])[0] : null;
}

export function getOrderByToken(token) {
  const o = db.prepare(`${ORDER_SELECT} WHERE o.token = ?`).get(String(token));
  return o ? attachItems([o])[0] : null;
}

/** Orders for the board: everything open, plus today's closed ones (latest first). */
export function listOrders({ scope = "board", day, limit = 300 } = {}) {
  let rows;
  if (scope === "board") {
    const today = localParts().day;
    rows = db.prepare(`${ORDER_SELECT}
      WHERE o.status IN ('new','preparing','ready')
         OR (o.local_day = ? )
         OR (o.payment_status = 'unpaid' AND o.status != 'cancelled')
      ORDER BY o.id DESC LIMIT ?`).all(today, limit);
  } else {
    rows = db.prepare(`${ORDER_SELECT} WHERE o.local_day = ? ORDER BY o.id DESC LIMIT ?`).all(day, limit);
  }
  return attachItems(rows);
}

/** Public view of an order for the customer's status page (no staff names). */
export function publicOrder(o) {
  if (!o) return null;
  return {
    token: o.token, number: o.number, status: o.status, room_name: o.room_name, room_slug: o.room_slug, customer_name: o.customer_name,
    total: o.total, subtotal: o.subtotal ?? o.total, discount: o.discount || 0, discount_code: o.discount_code,
    payment_status: o.payment_status, payment_method: o.payment_method, pay_pref: o.pay_pref,
    note: o.note, created_at: o.created_at, ready_at: o.ready_at,
    items: o.items.map((i) => ({ name: i.name, qty: i.qty, options_text: i.options_text, note: i.note, line_total: i.line_total })),
  };
}
