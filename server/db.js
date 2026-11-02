// SQLite storage using Node's built-in driver (no native build step).
// All money is stored as integer halalas (1 SAR = 100).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { hashPin } from "./auth.js";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, "cafe.db"));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'staff',   -- 'admin' | 'staff'
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT '',
  sort    INTEGER NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS items (
  id             INTEGER PRIMARY KEY,
  category_id    INTEGER NOT NULL REFERENCES categories(id),
  name           TEXT NOT NULL,
  name_ar        TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  price          INTEGER NOT NULL DEFAULT 0,
  options        TEXT NOT NULL DEFAULT '[]',  -- JSON option groups
  available      INTEGER NOT NULL DEFAULT 1,  -- 0 = sold out today
  room_orderable INTEGER NOT NULL DEFAULT 1,  -- 0 = counter only
  sort           INTEGER NOT NULL DEFAULT 0,
  deleted        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  code            TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  code_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sort            INTEGER NOT NULL DEFAULT 0
);

-- Employees list: used for name autocomplete and tabs.
CREATE TABLE IF NOT EXISTS people (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY,
  number          INTEGER NOT NULL,          -- resets daily
  local_day       TEXT NOT NULL,             -- YYYY-MM-DD in cafe timezone
  local_hour      INTEGER NOT NULL,
  token           TEXT NOT NULL UNIQUE,      -- public status link
  source          TEXT NOT NULL,             -- 'counter' | 'room'
  room_id         INTEGER REFERENCES rooms(id),
  room_name       TEXT,
  customer_name   TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'new', -- new|preparing|ready|completed|cancelled
  pay_pref        TEXT,                      -- what a room customer asked for
  payment_status  TEXT NOT NULL DEFAULT 'unpaid', -- unpaid|paid
  payment_method  TEXT,                      -- cash|card|tab|free
  tab_name        TEXT,
  total           INTEGER NOT NULL DEFAULT 0,
  cancel_reason   TEXT,
  created_by      INTEGER REFERENCES users(id),
  paid_by         INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  ready_at        TEXT,
  completed_at    TEXT,
  paid_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_day ON orders(local_day);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_tab ON orders(tab_name);

CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id       INTEGER REFERENCES items(id),
  name          TEXT NOT NULL,
  category_name TEXT NOT NULL DEFAULT '',
  qty           INTEGER NOT NULL,
  unit_price    INTEGER NOT NULL,   -- base + options
  options_text  TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  line_total    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oi_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS tab_payments (
  id         INTEGER PRIMARY KEY,
  tab_name   TEXT NOT NULL COLLATE NOCASE,
  amount     INTEGER NOT NULL,
  method     TEXT NOT NULL,         -- cash|card|payroll|writeoff
  note       TEXT NOT NULL DEFAULT '',
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  local_day  TEXT NOT NULL
);
`);

// ── Migrations for columns added after the first release ──
const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
if (!orderCols.includes("external_ref")) {
  db.exec("ALTER TABLE orders ADD COLUMN external_ref TEXT");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_orders_ext ON orders(external_ref)");
const catCols = db.prepare("PRAGMA table_info(categories)").all().map((c) => c.name);
if (!catCols.includes("deleted")) {
  db.exec("ALTER TABLE categories ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
}

// Discount codes.
db.exec(`
CREATE TABLE IF NOT EXISTS discount_codes (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind            TEXT NOT NULL DEFAULT 'percent',  -- percent | amount
  value           INTEGER NOT NULL,                 -- percent (1-100) or halalas
  max_discount    INTEGER,                          -- cap for percent codes (halalas), NULL = no cap
  min_order       INTEGER NOT NULL DEFAULT 0,       -- halalas
  scope           TEXT NOT NULL DEFAULT 'all',      -- all | counter | room
  starts_on       TEXT,                             -- YYYY-MM-DD, cafe-local, inclusive
  ends_on         TEXT,
  max_uses        INTEGER,                          -- NULL = unlimited
  once_per_person INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  deleted         INTEGER NOT NULL DEFAULT 0,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`);
const orderCols2 = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
if (!orderCols2.includes("subtotal")) db.exec("ALTER TABLE orders ADD COLUMN subtotal INTEGER");
if (!orderCols2.includes("discount")) db.exec("ALTER TABLE orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0");
if (!orderCols2.includes("discount_code")) db.exec("ALTER TABLE orders ADD COLUMN discount_code TEXT");
if (!orderCols2.includes("reward_points")) db.exec("ALTER TABLE orders ADD COLUMN reward_points INTEGER NOT NULL DEFAULT 0");
if (!orderCols2.includes("reward_discount")) db.exec("ALTER TABLE orders ADD COLUMN reward_discount INTEGER NOT NULL DEFAULT 0");
// Orders written by importers/older versions have no subtotal: it equals the total.
db.exec("UPDATE orders SET subtotal = total WHERE subtotal IS NULL");
db.exec("CREATE INDEX IF NOT EXISTS idx_orders_dcode ON orders(discount_code)");
// Arabic item name on each sold line (for the bilingual receipt). Older lines take it from the menu once.
if (!db.prepare("PRAGMA table_info(order_items)").all().some((c) => c.name === "name_ar")) {
  db.exec("ALTER TABLE order_items ADD COLUMN name_ar TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE order_items SET name_ar = COALESCE((SELECT name_ar FROM items WHERE items.id = order_items.item_id), '')");
}

export const DEFAULT_SETTINGS = {
  cafeName: "Twisted Minds Cafe",
  cafeNameAr: "",           // Arabic name: receipts must be in Arabic (ZATCA); also the QR seller name
  cafeAddress: "",          // seller address printed on the tax invoice
  crNumber: "",             // commercial registration (optional on receipt)
  timezone: process.env.TZ_CAFE || "Asia/Riyadh",
  vatRate: "15",            // prices are VAT-inclusive; receipt shows the VAT part
  vatNumber: "",
  receiptFooter: "Thank you! · شكراً لزيارتكم",
  roomOrdering: "open",     // open | closed
  publicUrl: "",            // base URL printed in room QR codes, e.g. http://192.168.1.50:8080
  autoPrintCounter: "0",    // auto-open receipt after a counter sale
  rewardsEnabled: "1",      // employee reward points (staff-only)
  rewardEarnPerSar: "1",    // points earned per 1 SAR paid
  rewardPointsPerSar: "20", // points that make 1 SAR off (20 → 5% back)
};

export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare("SELECT key, value FROM settings").all()) out[r.key] = r.value;
  return out;
}

export function setSettings(patch) {
  const stmt = db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_SETTINGS) stmt.run(k, String(v ?? ""));
  }
  return getSettings();
}

export function tx(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ── First-run seed ────────────────────────────────────────────────
function seed() {
  const users = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (users === 0) {
    db.prepare("INSERT INTO users(name, pin_hash, role) VALUES(?, ?, 'admin')").run("Admin", hashPin("1234"));
    console.log("[seed] Created admin user with PIN 1234. Change it in Team.");
  }
  const cats = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (cats === 0) {
    // Menu copied from the CafeMenu project defaults.
    const menu = [
      ["Hot Coffee", "القهوة الساخنة", [
        ["Espresso", "إسبريسو", 11], ["Cappuccino", "كابتشينو", 16], ["Latte", "لاتيه", 16],
        ["Flat White", "فلات وايت", 14], ["V60", "في 60", 19]]],
      ["Iced Coffee", "القهوة المثلجة", [["Ice Latte", "آيس لاتيه", 17], ["Ice V60", "آيس في 60", 21]]],
      ["Cold Drip", "كولد بيرو", [
        ["COD Small", "كولد بيرو صغير", 10], ["COD Large", "كولد بيرو كبير", 13],
        ["Ice COD Small", "آيس كولد بيرو صغير", 11], ["Ice COD Large", "آيس كولد بيرو كبير", 14]]],
      ["Refreshers", "منعشات", [["Water", "ماء", 4], ["Mojito", "موهيتو", 17]]],
    ];
    const milk = JSON.stringify([
      { name: "Milk", name_ar: "الحليب", type: "single", required: false,
        choices: [{ name: "Full fat", price: 0 }, { name: "Oat", price: 300 }, { name: "Almond", price: 300 }] },
      { name: "Sugar", name_ar: "السكر", type: "single", required: false,
        choices: [{ name: "No sugar", price: 0 }, { name: "Medium", price: 0 }, { name: "Sweet", price: 0 }] },
    ]);
    const milkDrinks = new Set(["Cappuccino", "Latte", "Flat White", "Ice Latte"]);
    tx(() => {
      menu.forEach(([cn, ca, items], ci) => {
        const cid = db.prepare("INSERT INTO categories(name, name_ar, sort) VALUES(?, ?, ?)").run(cn, ca, ci).lastInsertRowid;
        items.forEach(([n, a, p], ii) => {
          db.prepare("INSERT INTO items(category_id, name, name_ar, price, sort, options) VALUES(?, ?, ?, ?, ?, ?)")
            .run(cid, n, a, p * 100, ii, milkDrinks.has(n) ? milk : "[]");
        });
      });
    });
    console.log("[seed] Loaded starter menu from CafeMenu.");
  }
}
seed();
