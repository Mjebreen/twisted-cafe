// Activity log: who did what, when. One middleware records every staff action, so new routes are covered by default.
import { db } from "./db.js";
import { localParts } from "./orders.js";

db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  local_day TEXT NOT NULL,
  user_id   INTEGER,
  actor     TEXT NOT NULL DEFAULT '',   -- staff name, or the customer name for room orders
  category  TEXT NOT NULL,              -- auth|order|payment|menu|room|team|settings|tab|report|system
  message   TEXT NOT NULL,
  ip        TEXT NOT NULL DEFAULT '',
  ok        INTEGER NOT NULL DEFAULT 1  -- 0 = failed attempt (wrong PIN, wrong room code…)
);
CREATE INDEX IF NOT EXISTS idx_audit_day ON audit_log(local_day);
`);

let onLog = () => {};
export function setLogListener(fn) { onLog = fn; }

const sar = (h) => `SAR ${(Number(h || 0) / 100).toFixed(2).replace(/\.00$/, "")}`;

export function writeLog({ user, actor, category, message, ip = "", ok = true }) {
  const now = new Date();
  const row = {
    at: now.toISOString(), local_day: localParts(now).day, user_id: user?.id ?? null,
    actor: actor ?? user?.name ?? "", category, message: String(message).slice(0, 500), ip: String(ip || ""), ok: ok ? 1 : 0,
  };
  const id = db.prepare(`INSERT INTO audit_log(at, local_day, user_id, actor, category, message, ip, ok)
    VALUES(?,?,?,?,?,?,?,?)`).run(row.at, row.local_day, row.user_id, row.actor, row.category, row.message, row.ip, row.ok).lastInsertRowid;
  const line = { id: Number(id), ...row };
  console.log(`[log] ${row.at} ${row.ok ? "" : "FAILED "}${row.category} · ${row.actor || "-"} · ${row.message}`);
  try { onLog(line); } catch { /* ignore */ }
  return line;
}

// Name lookups taken BEFORE the request runs (so deletes can still say what was deleted).
function snapshot(path) {
  const m = path.match(/^\/api\/(categories|items|rooms|people|users|orders|discounts)\/(\d+)/);
  if (!m) return null;
  const [, kind, id] = m;
  const q = {
    categories: "SELECT name FROM categories WHERE id = ?",
    items: "SELECT name, price, available FROM items WHERE id = ?",
    rooms: "SELECT name, code, active FROM rooms WHERE id = ?",
    people: "SELECT name, active FROM people WHERE id = ?",
    users: "SELECT name, role, active FROM users WHERE id = ?",
    orders: "SELECT number, local_day, total, status, payment_status, payment_method FROM orders WHERE id = ?",
    discounts: "SELECT code FROM discount_codes WHERE id = ?",
  }[kind];
  return db.prepare(q).get(Number(id)) || null;
}

const STATUS = { new: "New", preparing: "Preparing", ready: "Ready", completed: "Delivered/Done", cancelled: "Cancelled" };
const ORDER_LABEL = (o) => (o ? `#${o.number} (${o.local_day})` : "order");

/** Turn a finished request into a log line, or null if it isn't worth logging. */
function describe(req, res, before, body) {
  const route = `${req.method} ${req.route?.path ?? req.path}`;
  const b = req.body || {};
  const ok = res.statusCode < 400;
  const err = body?.error ? ` — ${body.error}` : "";
  switch (route) {
    case "POST /api/auth/login":
      return ok ? { category: "auth", message: "Signed in", user: body, actor: body?.name }
        : { category: "auth", message: `Failed sign-in${err}`, ok: false, actor: "unknown" };
    case "POST /api/auth/logout":
      return { category: "auth", message: "Signed out" };
    case "POST /api/public/rooms/:slug/verify":
      return ok ? null : { category: "room", message: `Wrong room code entered for ${req.params.slug}${err}`, ok: false, actor: "guest" };
    case "POST /api/public/orders":
      return ok
        ? { category: "order", actor: body?.customer_name, message: `Room order #${body?.number} from ${body?.room_name} · ${sar(body?.total)}${body?.discount_code ? ` (code ${body.discount_code} −${sar(body.discount)})` : ""} · wants ${b.payPref || "-"}` }
        : { category: "order", actor: String(b.name || "guest"), ok: false, message: `Room order rejected (${b.room})${err}` };
    case "POST /api/orders":
      return ok ? {
        category: "order",
        message: `${body?.source === "room" ? `Order for ${body?.room_name}` : "Counter sale"} #${body?.number} · ${sar(body?.total)} · ${
          body?.payment_status === "paid" ? `paid ${body?.payment_method}${body?.tab_name ? ` (${body.tab_name})` : ""}` : "unpaid"}${
          body?.customer_name ? ` · ${body.customer_name}` : ""}${body?.discount_code ? ` · code ${body.discount_code} −${sar(body.discount)}` : ""}${
          body?.reward_points ? ` · ${body.reward_points} points −${sar(body.reward_discount)}` : ""}`,
      } : null;
    case "POST /api/orders/:id/status":
      return ok ? { category: "order", message: `Order ${ORDER_LABEL(before)}: ${STATUS[before?.status] || before?.status} → ${STATUS[b.status] || b.status}${b.reason ? ` (reason: ${b.reason})` : ""}` } : null;
    case "POST /api/orders/:id/pay":
      return ok ? { category: "payment", message: `Order ${ORDER_LABEL(before)} paid ${b.method}${b.tabName ? ` to ${b.tabName}'s tab` : ""} · ${sar(before?.total)}` } : null;
    case "POST /api/orders/:id/unpay":
      return ok ? { category: "payment", message: `Payment undone on order ${ORDER_LABEL(before)} (was ${before?.payment_method}, ${sar(before?.total)})` } : null;
    case "POST /api/rewards/:name/adjust":
      return ok ? { category: "reward", message: `${body?.points > 0 ? "Added" : "Removed"} ${Math.abs(body?.points)} points ${body?.points > 0 ? "to" : "from"} ${body?.name} (${b.note}) · balance ${body?.balance}` }
        : { category: "reward", ok: false, message: `Points change for ${req.params.name} refused${err}` };
    case "POST /api/tabs/:name/pay":
      return ok ? { category: "tab", message: `Tab payment from ${req.params.name}: ${sar(b.amount)} by ${b.method}${b.note ? ` (${b.note})` : ""}` } : null;
    case "POST /api/categories":
      return ok ? { category: "menu", message: `Added category "${b.name}"` } : null;
    case "PATCH /api/categories/:id":
      return ok ? { category: "menu", message: `Changed category "${before?.name}"${b.name && b.name !== before?.name ? ` → "${b.name}"` : ""}${"active" in b ? (b.active ? " (shown)" : " (hidden)") : ""}` } : null;
    case "DELETE /api/categories/:id":
      return ok ? { category: "menu", message: `Deleted category "${before?.name}"${body?.itemsDeleted ? ` and its ${body.itemsDeleted} item(s)` : ""}` } : null;
    case "POST /api/items":
      return ok ? { category: "menu", message: `Added item "${b.name}" · ${sar(b.price)}` } : null;
    case "PATCH /api/items/:id": {
      if (!ok) return null;
      const changes = [];
      if (b.name && b.name !== before?.name) changes.push(`name → "${b.name}"`);
      if (b.price !== undefined && Number(b.price) !== before?.price) changes.push(`price ${sar(before?.price)} → ${sar(b.price)}`);
      if (b.options !== undefined) changes.push("options");
      if (b.sort !== undefined && Object.keys(b).length === 1) return null; // reordering is noise
      return { category: "menu", message: `Changed item "${before?.name}"${changes.length ? `: ${changes.join(", ")}` : ""}` };
    }
    case "PATCH /api/items/:id/availability":
      return ok ? { category: "menu", message: `"${before?.name}" marked ${b.available ? "back in stock" : "sold out"}` } : null;
    case "DELETE /api/items/:id":
      return ok ? { category: "menu", message: `Deleted item "${before?.name}"` } : null;
    case "POST /api/menu/import":
      return ok ? { category: "menu", message: `CSV menu import: ${body?.added} added, ${body?.updated} updated` } : null;
    case "POST /api/import/pos2":
      return ok ? { category: "system", message: `POS2 import: ${body?.items} items, ${body?.rooms} new rooms, ${body?.orders} orders` } : null;
    case "POST /api/rooms":
      return ok ? { category: "room", message: `Added room "${b.name}"` } : null;
    case "PATCH /api/rooms/:id": {
      if (!ok) return null;
      const parts = [];
      if (b.name && b.name !== before?.name) parts.push(`renamed to "${b.name}"`);
      if (b.code !== undefined) parts.push("code changed manually");
      if ("active" in b) parts.push(b.active ? "enabled" : "disabled");
      return { category: "room", message: `Room "${before?.name}" ${parts.join(", ") || "updated"}` };
    }
    case "POST /api/rooms/:id/rotate":
      return ok ? { category: "room", message: `New code for room "${before?.name}"` } : null;
    case "POST /api/rooms/rotate-all":
      return ok ? { category: "room", message: "New codes for all rooms" } : null;
    case "DELETE /api/rooms/:id":
      return ok ? { category: "room", message: `Removed room "${before?.name}"` } : null;
    case "POST /api/people/merge":
      return ok ? { category: "team", message: `Merged ${(body?.from || []).map((n) => `"${n}"`).join(", ")} into "${body?.into}" (${body?.orders} orders, ${body?.tabOrders} tab charges, ${body?.tabPayments} tab payments)` } : null;
    case "POST /api/people/ignore":
      return ok ? { category: "team", message: `Marked as different people: ${(b.names || []).map((n) => `"${n}"`).join(", ")}` } : null;
    case "POST /api/people":
      return ok ? { category: "team", message: `Added employee "${b.name}"` } : null;
    case "PATCH /api/people/:id":
      return ok ? { category: "team", message: `Employee "${before?.name}"${b.name && b.name !== before?.name ? ` renamed to "${b.name}"` : ""}${"active" in b ? (b.active ? " shown" : " hidden") : ""}` } : null;
    case "DELETE /api/people/:id":
      return ok ? { category: "team", message: `Deleted employee "${before?.name}"` } : null;
    case "POST /api/users":
      return ok ? { category: "team", message: `Added staff login "${b.name}" (${b.role || "staff"})` } : null;
    case "PATCH /api/users/:id": {
      if (!ok) return null;
      const parts = [];
      if (b.pin) parts.push("PIN changed");
      if (b.role && b.role !== before?.role) parts.push(`role → ${b.role}`);
      if ("active" in b) parts.push(b.active ? "enabled" : "disabled");
      if (b.name && b.name !== before?.name) parts.push(`renamed to "${b.name}"`);
      return { category: "team", message: `Staff "${before?.name}": ${parts.join(", ") || "updated"}` };
    }
    case "POST /api/discounts":
      return ok ? { category: "menu", message: `Added discount code ${body?.code} (${body?.kind === "percent" ? `${body?.value}%` : sar(body?.value)} off)` } : null;
    case "PATCH /api/discounts/:id":
      return ok ? { category: "menu", message: `Changed discount code ${body?.code}${"active" in b && Object.keys(b).length === 1 ? (b.active ? " (turned on)" : " (turned off)") : ""}` } : null;
    case "DELETE /api/discounts/:id":
      return ok ? { category: "menu", message: `Deleted discount code ${before?.code ?? ""}` } : null;
    case "POST /api/discounts/check":
    case "POST /api/public/discount":
      return ok ? null : { category: "order", ok: false, actor: String(b.name || b.customerName || "guest"), message: `Discount code "${b.discountCode ?? b.code}" refused${err}` };
    case "PUT /api/settings":
      return ok ? { category: "settings", message: `Settings saved (${Object.keys(b).filter((k) => req._settingsBefore?.[k] !== String(b[k] ?? "")).join(", ") || "no changes"})` } : null;
    case "POST /api/settings/room-ordering":
      return ok ? { category: "settings", message: `Room ordering ${b.open ? "opened" : "closed"}` } : null;
    case "GET /api/backup":
      return { category: "system", message: "Downloaded database backup" };
    case "GET /api/reports/items.csv":
    case "GET /api/reports/orders.csv":
      return { category: "report", message: `Exported ${req.path.includes("items") ? "items" : "orders"} CSV (${req.query.from || "today"} to ${req.query.to || req.query.from || "today"})` };
    default:
      // Any other successful change still gets a generic line, so nothing slips through.
      if (req.method !== "GET" && ok && req.path.startsWith("/api/") && !req.path.startsWith("/api/public/")) {
        return { category: "system", message: `${req.method} ${req.path}` };
      }
      return null;
  }
}

export function auditMiddleware({ currentUser, getSettings }) {
  return (req, res, next) => {
    const isWrite = req.method !== "GET";
    const isLoggedGet = req.method === "GET" && /^\/api\/(backup|reports\/(items|orders)\.csv)/.test(req.path);
    if (!req.path.startsWith("/api/") || (!isWrite && !isLoggedGet)) return next();
    const before = snapshot(req.path);
    const who = currentUser(req);
    if (req.path === "/api/settings" && req.method === "PUT") req._settingsBefore = getSettings();
    let body;
    const json = res.json.bind(res);
    res.json = (data) => { body = data; return json(data); };
    res.on("finish", () => {
      try {
        const d = describe(req, res, before, body);
        if (!d) return;
        writeLog({ user: d.user ?? who, actor: d.actor, category: d.category, message: d.message, ip: req.ip, ok: d.ok ?? true });
      } catch (e) {
        console.error("[log] failed to write activity log", e);
      }
    });
    next();
  };
}
