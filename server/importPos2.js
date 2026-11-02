// Import a POS2 "tenant-data-export" JSON: menu, option questions, tables (as rooms), and order history.
// Safe to run more than once: menu and rooms are matched by name, orders by their POS2 id.
import crypto from "node:crypto";
import { db, tx, setSettings } from "./db.js";
import { localParts } from "./orders.js";
import { isTimeZone } from "./receipt.js";

// Arabic names for known items (POS2 export has none).
const AR = {
  "Espresso": "إسبريسو", "Cappuccino": "كابتشينو", "Latte": "لاتيه", "Flat White": "فلات وايت", "V60": "في 60",
  "Spanish Latte": "سبانش لاتيه", "Iced Latte": "آيس لاتيه", "Iced V60": "آيس في 60",
  "Iced Spanish Latte": "آيس سبانش لاتيه", "Coffee Of The Day Small": "قهوة اليوم صغير",
  "Coffee Of The Day Large": "قهوة اليوم كبير", "Iced Coffee Of The Day Small": "آيس قهوة اليوم صغير",
  "Iced Coffee Of The Day Large": "آيس قهوة اليوم كبير", "Mojito": "موهيتو", "Water": "ماء",
};
const CAT = { Hot: ["Hot Drinks", "مشروبات ساخنة"], Cold: ["Cold Drinks", "مشروبات باردة"] };
const PAY = { terminal: "card", card: "card", cash: "cash", other: "cash" };

// "نوع المحصول - Coffee Type" → { name: "Coffee Type", name_ar: "نوع المحصول" }
function splitLabel(label) {
  const parts = String(label).split(/\s+-\s+/);
  const ar = parts.find((p) => /[؀-ۿ]/.test(p)) || "";
  const en = parts.find((p) => !/[؀-ۿ]/.test(p)) || label;
  return { name: en.trim(), name_ar: ar.trim() };
}

export function importPos2(data, { orders: withOrders = true, replaceMenu = true } = {}) {
  if (!data || !Array.isArray(data.products)) throw new Error("Not a POS2 export (no products)");
  const report = { categories: 0, items: 0, itemsRemoved: 0, rooms: 0, orders: 0, ordersSkipped: 0 };

  tx(() => {
    // ── Menu ──
    const catIds = new Map();
    const catFor = (p) => {
      const key = p.subcategory || p.category || "Menu";
      if (catIds.has(key)) return catIds.get(key);
      const [name, name_ar] = CAT[key] || [key, ""];
      let c = db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE ORDER BY deleted, id").get(name);
      if (!c) {
        const sort = (db.prepare("SELECT MAX(sort) AS m FROM categories").get().m ?? -1) + 1;
        c = { id: Number(db.prepare("INSERT INTO categories(name, name_ar, sort) VALUES(?,?,?)").run(name, name_ar, sort).lastInsertRowid) };
        report.categories++;
      }
      db.prepare("UPDATE categories SET active = 1, deleted = 0 WHERE id = ?").run(c.id);
      catIds.set(key, c.id);
      return c.id;
    };
    const questions = data.product_questions || [];
    const keep = new Set();
    const productItem = new Map(); // POS2 product id → our item id
    const rank = (p) => ({ Hot: 0, Cold: 1 })[p.subcategory] ?? 2; // hot drinks first
    const ordered = [...data.products].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
    ordered.forEach((p, i) => {
      const options = questions.filter((q) => q.product_id === p.id && Array.isArray(q.options) && q.options.length)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((q) => ({
          ...splitLabel(q.label),
          type: q.type === "multi" || q.type === "multiple" ? "multi" : "single",
          required: !!q.required,
          choices: q.options.map((o) => ({ name: String(typeof o === "object" ? o.label ?? o.name : o), price: 0 })),
        }));
      const cid = catFor(p);
      const ex = db.prepare("SELECT id, name_ar FROM items WHERE name = ? COLLATE NOCASE AND deleted = 0").get(p.name);
      const fields = [cid, p.name, ex?.name_ar || AR[p.name] || "", p.description || "", p.price_cents, JSON.stringify(options), i];
      let id;
      if (ex) {
        db.prepare("UPDATE items SET category_id=?, name=?, name_ar=?, description=?, price=?, options=?, sort=? WHERE id=?").run(...fields, ex.id);
        id = ex.id;
      } else {
        id = Number(db.prepare("INSERT INTO items(category_id, name, name_ar, description, price, options, sort) VALUES(?,?,?,?,?,?,?)").run(...fields).lastInsertRowid);
      }
      report.items++;
      keep.add(id);
      productItem.set(p.id, id);
    });
    if (replaceMenu) {
      for (const it of db.prepare("SELECT id FROM items WHERE deleted = 0").all()) {
        if (!keep.has(it.id)) {
          db.prepare("UPDATE items SET deleted = 1 WHERE id = ?").run(it.id);
          report.itemsRemoved++;
        }
      }
      db.prepare(`UPDATE categories SET active = 0 WHERE id NOT IN (SELECT DISTINCT category_id FROM items WHERE deleted = 0)`).run();
    }

    // ── Rooms (POS2 tables; the "Counter" table is walk-in, not a room) ──
    const roomByTable = new Map();
    for (const t of data.tables || []) {
      if (/^counter$/i.test(t.name)) continue;
      let r = db.prepare("SELECT * FROM rooms WHERE name = ? COLLATE NOCASE").get(t.name);
      if (!r) {
        let slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `room-${t.id}`;
        while (db.prepare("SELECT 1 FROM rooms WHERE slug = ?").get(slug)) slug += "-2";
        const sort = (db.prepare("SELECT MAX(sort) AS m FROM rooms").get().m ?? -1) + 1;
        db.prepare("INSERT INTO rooms(name, slug, code, active, sort) VALUES(?,?,?,?,?)")
          .run(t.name, slug, String(t.order_pin || "").trim() || String(crypto.randomInt(0, 10000)).padStart(4, "0"), t.is_active ? 1 : 0, sort);
        r = db.prepare("SELECT * FROM rooms WHERE slug = ?").get(slug);
        report.rooms++;
      }
      roomByTable.set(t.id, r);
    }

    if (isTimeZone(data.tenant?.timezone)) setSettings({ timezone: data.tenant.timezone });
    if (data.tenant?.name) setSettings({ cafeName: `${data.tenant.name} Cafe` });
    const vat = (data.taxes || []).find((t) => t.id === data.tenant?.default_tax_id);
    if (vat) setSettings({ vatRate: String(vat.rate_percent) });

    // ── Order history ──
    if (withOrders) {
      const products = new Map(data.products.map((p) => [p.id, p]));
      const itemsByOrder = new Map();
      for (const it of data.order_items || []) {
        if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
        itemsByOrder.get(it.order_id).push(it);
      }
      const asUtc = (s) => (s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : null);
      const list = [...(data.orders || [])].filter((o) => !o.deleted_at).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      for (const o of list) {
        const ref = `pos2:${o.id}`;
        if (db.prepare("SELECT 1 FROM orders WHERE external_ref = ?").get(ref)) { report.ordersSkipped++; continue; }
        const created = asUtc(o.created_at);
        const { day, hour } = localParts(created, data.tenant?.timezone || "Asia/Riyadh");
        const lines = (itemsByOrder.get(o.id) || []).filter((i) => i.status !== "cancelled" && !i.removed_at);
        const allLines = itemsByOrder.get(o.id) || [];
        const use = lines.length ? lines : allLines; // keep lines on cancelled orders for the record
        const room = roomByTable.get(o.table_id) || null;
        const cancelled = o.status === "cancelled" || o.status === "pending" || lines.length === 0;
        const paid = o.status === "paid";
        const total = (cancelled ? use : lines).reduce((s, i) => s + i.price_cents * i.quantity, 0);
        const number = (db.prepare("SELECT MAX(number) AS m FROM orders WHERE local_day = ?").get(day).m || 0) + 1;
        const iso = created.toISOString();
        const paidAt = asUtc(o.paid_at)?.toISOString() ?? (paid ? iso : null);
        const customer = o.customer_name && !/^counter$/i.test(o.customer_name) ? String(o.customer_name).slice(0, 60) : "";
        const id = db.prepare(`INSERT INTO orders(number, local_day, local_hour, token, source, room_id, room_name, customer_name, note,
            status, payment_status, payment_method, total, cancel_reason, created_at, updated_at, completed_at, paid_at, external_ref)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          number, day, hour, crypto.randomBytes(12).toString("base64url"), room ? "room" : "counter", room?.id ?? null,
          room?.name ?? null, customer, o.notes || "", cancelled ? "cancelled" : "completed",
          paid ? "paid" : "unpaid", paid ? PAY[o.payment_method] || "cash" : null, total,
          cancelled ? (o.status === "pending" ? "Left open in POS2" : `Cancelled in POS2${o.cancelled_by ? ` (${o.cancelled_by})` : ""}`) : null,
          iso, iso, cancelled ? null : (paidAt || iso), paid ? paidAt : null, ref,
        ).lastInsertRowid;
        const arOf = (itemId) => (itemId ? db.prepare("SELECT name_ar FROM items WHERE id = ?").get(itemId)?.name_ar || "" : "");
        for (const i of use) {
          const p = products.get(i.product_id);
          const catKey = p?.subcategory || p?.category || "";
          db.prepare(`INSERT INTO order_items(order_id, item_id, name, name_ar, category_name, qty, unit_price, options_text, note, line_total)
            VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, productItem.get(i.product_id) ?? null, i.product_name || p?.name || "Item", arOf(productItem.get(i.product_id)),
            (CAT[catKey] || [catKey])[0], i.quantity, i.price_cents,
            String(i.customization_summary || i.line_modifiers_summary || "").slice(0, 200), i.notes || "", i.price_cents * i.quantity);
        }
        report.orders++;
      }
    }
  });
  return report;
}

// CLI: node server/importPos2.js <tenant-export.json> [--menu-only] [--keep-menu]
if (process.argv[1] && process.argv[1].endsWith("importPos2.js")) {
  const fs = await import("node:fs");
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node server/importPos2.js <tenant-export.json> [--menu-only] [--keep-menu]");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const r = importPos2(data, { orders: !process.argv.includes("--menu-only"), replaceMenu: !process.argv.includes("--keep-menu") });
  console.log("Imported from POS2:", r);
}
