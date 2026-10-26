// Employee names: listing every name used anywhere, finding likely duplicates, and merging them.
import { db, tx } from "./db.js";
import { cleanText, HttpError } from "./orders.js";

db.exec(`
CREATE TABLE IF NOT EXISTS name_pairs_ignored (
  a TEXT NOT NULL,   -- normalized keys, a < b
  b TEXT NOT NULL,
  PRIMARY KEY (a, b)
);
`);

/** Lowercase, strip accents/punctuation/tatweel/harakat, unify Arabic letter variants, collapse spaces. */
export function normName(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")            // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().replace(/\s+/g, " ");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Every distinct name (case-insensitive) used in the employee list, orders, tabs and tab payments, with usage. */
export function allNames() {
  const rows = db.prepare(`
    WITH used AS (
      SELECT customer_name AS name, 1 AS o, 0 AS t, created_at AS at FROM orders WHERE customer_name != ''
      UNION ALL SELECT tab_name, 0, 1, created_at FROM orders WHERE tab_name IS NOT NULL AND tab_name != ''
      UNION ALL SELECT tab_name, 0, 1, created_at FROM tab_payments
    )
    SELECT name, SUM(o) AS orders, SUM(t) AS tab_entries, MAX(at) AS last_seen FROM used GROUP BY name COLLATE NOCASE
  `).all();
  const people = db.prepare("SELECT id, name, active FROM people").all();
  const map = new Map();
  for (const p of people) map.set(p.name.toLowerCase(), { name: p.name, person_id: p.id, active: p.active, orders: 0, tab_entries: 0, last_seen: null });
  for (const r of rows) {
    const k = r.name.toLowerCase();
    const cur = map.get(k) || { name: r.name, person_id: null, active: null, orders: 0, tab_entries: 0, last_seen: null };
    map.set(k, { ...cur, orders: r.orders, tab_entries: r.tab_entries, last_seen: r.last_seen });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Groups of names that look like the same person. Pairs marked "not the same" are skipped. */
export function duplicateGroups() {
  const names = allNames();
  const keys = names.map((n) => normName(n.name));
  const ignored = new Set(db.prepare("SELECT a, b FROM name_pairs_ignored").all().map((r) => `${r.a}|${r.b}`));
  const isIgnored = (x, y) => ignored.has(x < y ? `${x}|${y}` : `${y}|${x}`);
  const parent = names.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const reason = new Map();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = keys[i], b = keys[j];
      if (!a || !b || isIgnored(a, b)) continue;
      let why = null;
      if (a === b) why = "same letters";
      else if (a.replace(/ /g, "") === b.replace(/ /g, "")) why = "spacing";
      else {
        const d = levenshtein(a, b);
        const limit = Math.min(a.length, b.length) >= 8 ? 2 : 1;
        if (d <= limit) why = "spelling";
        else {
          // "Sara" vs "Sara Ahmed": same first name and one is just a shorter form.
          const ta = a.split(" "), tb = b.split(" ");
          const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
          if (short.length < long.length && short.every((t, k) => long[k] === t) && short[0].length >= 3) why = "short form";
        }
      }
      if (why) {
        parent[find(i)] = find(j);
        reason.set(`${i}|${j}`, why);
      }
    }
  }
  const groups = new Map();
  names.forEach((n, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push({ ...n, key: keys[i] });
  });
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      // Suggest keeping the most-used name that is on the employee list.
      const keep = [...g].sort((x, y) => (y.person_id ? 1 : 0) - (x.person_id ? 1 : 0) || (y.orders + y.tab_entries) - (x.orders + x.tab_entries) || y.name.length - x.name.length)[0];
      const reasons = new Set();
      for (const [k, v] of reason) {
        const [i, j] = k.split("|").map(Number);
        if (g.some((x) => x.key === keys[i]) && g.some((x) => x.key === keys[j])) reasons.add(v);
      }
      return { names: g, suggested: keep.name, reasons: [...reasons] };
    })
    .sort((a, b) => b.names.reduce((s, n) => s + n.orders, 0) - a.names.reduce((s, n) => s + n.orders, 0));
}

/** Rename every use of the `from` names to `into`. Case-insensitive. Returns what changed. */
export function mergeNames(into, from) {
  const target = cleanText(into, 60);
  if (target.length < 2) throw new HttpError(400, "Pick the name to keep");
  const sources = [...new Set((Array.isArray(from) ? from : []).map((f) => cleanText(f, 60)).filter(Boolean))]
    .filter((f) => f.toLowerCase() !== target.toLowerCase() || f !== target);
  if (!sources.length) throw new HttpError(400, "Pick at least one name to merge");
  return tx(() => {
    const out = { orders: 0, tabOrders: 0, tabPayments: 0, removed: 0 };
    for (const s of sources) {
      out.orders += Number(db.prepare("UPDATE orders SET customer_name = ? WHERE customer_name = ? COLLATE NOCASE").run(target, s).changes);
      out.tabOrders += Number(db.prepare("UPDATE orders SET tab_name = ? WHERE tab_name = ? COLLATE NOCASE").run(target, s).changes);
      out.tabPayments += Number(db.prepare("UPDATE tab_payments SET tab_name = ? WHERE tab_name = ? COLLATE NOCASE").run(target, s).changes);
      if (s.toLowerCase() !== target.toLowerCase()) {
        out.removed += Number(db.prepare("DELETE FROM people WHERE name = ? COLLATE NOCASE").run(s).changes);
      }
    }
    // Same name typed with different capitals ("sara ahmed") becomes the exact chosen spelling too.
    db.prepare("UPDATE orders SET customer_name = ? WHERE customer_name = ? COLLATE NOCASE AND customer_name != ?").run(target, target, target);
    db.prepare("UPDATE orders SET tab_name = ? WHERE tab_name = ? COLLATE NOCASE AND tab_name != ?").run(target, target, target);
    db.prepare("UPDATE tab_payments SET tab_name = ? WHERE tab_name = ? COLLATE NOCASE AND tab_name != ?").run(target, target, target);
    // Keep exactly one employee entry, spelled as chosen.
    const existing = db.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(target);
    if (existing) db.prepare("UPDATE people SET name = ?, active = 1 WHERE id = ?").run(target, existing.id);
    else db.prepare("INSERT INTO people(name) VALUES(?)").run(target);
    return { into: target, from: sources, ...out };
  });
}

export function ignorePair(names) {
  const keys = [...new Set((names || []).map(normName).filter(Boolean))];
  if (keys.length < 2) throw new HttpError(400, "Need at least two names");
  const ins = db.prepare("INSERT OR IGNORE INTO name_pairs_ignored(a, b) VALUES(?, ?)");
  tx(() => {
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const [a, b] = keys[i] < keys[j] ? [keys[i], keys[j]] : [keys[j], keys[i]];
        ins.run(a, b);
      }
    }
  });
  return { ok: true };
}
