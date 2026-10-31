// Staff-only reward points for employees: earn points per SAR spent, spend them as SAR off at the counter.
import { db, getSettings } from "./db.js";
import { cleanText, HttpError, localParts, nowIso } from "./orders.js";

db.exec(`
CREATE TABLE IF NOT EXISTS reward_ledger (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  points     INTEGER NOT NULL,            -- + earned / added, − spent / removed
  kind       TEXT NOT NULL,               -- earn | redeem | adjust
  order_id   INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  user_id    INTEGER,
  created_at TEXT NOT NULL,
  local_day  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reward_name ON reward_ledger(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_reward_order ON reward_ledger(order_id);
`);

/** Current reward settings as numbers. */
export function rewardConfig() {
  const s = getSettings();
  return {
    enabled: s.rewardsEnabled === "1",
    earnPerSar: Math.max(0, Number(s.rewardEarnPerSar) || 0),       // points per 1 SAR paid
    pointsPerSar: Math.max(1, Math.trunc(Number(s.rewardPointsPerSar) || 1)), // points worth 1 SAR off
  };
}

export function balanceOf(name) {
  const n = cleanText(name, 60);
  if (!n) return 0;
  return db.prepare("SELECT COALESCE(SUM(points),0) AS p FROM reward_ledger WHERE name = ? COLLATE NOCASE").get(n).p;
}

/** SAR value (halalas) of a number of points. */
export function pointsValue(points, cfg = rewardConfig()) {
  return Math.floor((points * 100) / cfg.pointsPerSar);
}

/**
 * Work out a redemption for an order. Never takes more points than the order needs.
 * Returns { points, amount } (amount in halalas) or null.
 */
export function planRedeem(name, wanted, maxAmount) {
  const cfg = rewardConfig();
  const who = cleanText(name, 60);
  let points = Math.trunc(Number(wanted) || 0);
  if (points <= 0) return null;
  if (!cfg.enabled) throw new HttpError(409, "Rewards are turned off");
  if (!who) throw new HttpError(400, "Enter the employee's name to use points");
  const bal = balanceOf(who);
  if (points > bal) throw new HttpError(409, `${who} only has ${bal} points`);
  if (maxAmount <= 0) return null;
  const needed = Math.ceil((maxAmount * cfg.pointsPerSar) / 100);
  if (points > needed) points = needed;
  const amount = Math.min(maxAmount, pointsValue(points, cfg));
  if (amount <= 0) throw new HttpError(409, `Needs at least ${cfg.pointsPerSar} points for SAR 1`);
  return { points, amount };
}

export function writeRedeem(orderId, name, points, userId) {
  db.prepare(`INSERT INTO reward_ledger(name, points, kind, order_id, note, user_id, created_at, local_day)
    VALUES(?,?,?,?,?,?,?,?)`).run(cleanText(name, 60), -points, "redeem", orderId, "", userId ?? null, nowIso(), localParts().day);
}

/**
 * Keep the ledger in step with an order after it is created, paid, un-paid or cancelled.
 * Earn: paid (not free), not cancelled, has a name. Name = tab name for tab orders, else customer name.
 * Cancelled orders also give back any points spent on them.
 */
export function syncOrderRewards(orderId) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(orderId));
  if (!o) return;
  if (o.status === "cancelled") {
    db.prepare("DELETE FROM reward_ledger WHERE order_id = ? AND kind IN ('earn','redeem')").run(o.id);
    return;
  }
  const who = cleanText(o.payment_method === "tab" ? o.tab_name : o.customer_name, 60);
  const eligible = o.payment_status === "paid" && o.payment_method !== "free" && who && o.total > 0;
  const cur = db.prepare("SELECT * FROM reward_ledger WHERE order_id = ? AND kind = 'earn'").get(o.id);
  if (eligible && cur && cur.name.toLowerCase() === who.toLowerCase()) return; // already earned
  if (cur) db.prepare("DELETE FROM reward_ledger WHERE id = ?").run(cur.id);
  if (!eligible) return;
  const cfg = rewardConfig();
  if (!cfg.enabled) return;
  const points = Math.floor((o.total / 100) * cfg.earnPerSar);
  if (points <= 0) return;
  db.prepare(`INSERT INTO reward_ledger(name, points, kind, order_id, note, user_id, created_at, local_day)
    VALUES(?,?,?,?,?,?,?,?)`).run(who, points, "earn", o.id, "", o.paid_by ?? null, nowIso(), localParts().day);
}

/** Everyone with a points history, highest balance first. */
export function rewardBalances() {
  return db.prepare(`SELECT name, SUM(points) AS balance,
      SUM(CASE WHEN points > 0 THEN points ELSE 0 END) AS earned,
      -SUM(CASE WHEN points < 0 THEN points ELSE 0 END) AS spent,
      MAX(created_at) AS last
    FROM reward_ledger GROUP BY name COLLATE NOCASE ORDER BY balance DESC, name`).all();
}

export function rewardHistory(name) {
  const n = cleanText(name, 60);
  const rows = db.prepare(`SELECT r.*, u.name AS user_name, o.number AS order_number, o.local_day AS order_day, o.total AS order_total
    FROM reward_ledger r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN orders o ON o.id = r.order_id
    WHERE r.name = ? COLLATE NOCASE ORDER BY r.id DESC LIMIT 300`).all(n);
  return { name: n, balance: balanceOf(n), rows };
}

export function adjustPoints(name, points, note, userId) {
  const n = cleanText(name, 60);
  const p = Math.trunc(Number(points) || 0);
  if (n.length < 2) throw new HttpError(400, "Pick an employee");
  if (!p) throw new HttpError(400, "Enter points to add or remove");
  if (Math.abs(p) > 100000) throw new HttpError(400, "That's too many points");
  const why = cleanText(note, 200);
  if (!why) throw new HttpError(400, "Add a reason");
  if (p < 0 && balanceOf(n) + p < 0) throw new HttpError(409, `${n} only has ${balanceOf(n)} points`);
  db.prepare(`INSERT INTO reward_ledger(name, points, kind, order_id, note, user_id, created_at, local_day)
    VALUES(?,?,?,?,?,?,?,?)`).run(n, p, "adjust", null, why, userId ?? null, nowIso(), localParts().day);
  return { name: n, points: p, balance: balanceOf(n) };
}
