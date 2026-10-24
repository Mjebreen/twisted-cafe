// Sales reports over a range of cafe-local days (inclusive).
import { db } from "./db.js";

// "Sales" = non-cancelled orders, excluding complimentary ('free') ones.
// Unpaid orders count as sales (they are owed); they are also reported separately.
const BASE = "FROM orders o WHERE o.local_day BETWEEN ? AND ? AND o.status != 'cancelled'";
const SALE = "(COALESCE(o.payment_method,'') != 'free')";

export function summary(from, to) {
  const a = [from, to];
  const totals = db.prepare(`SELECT
      COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN ${SALE} THEN o.total END),0) AS sales,
      COALESCE(SUM(CASE WHEN o.payment_method='free' THEN o.total END),0) AS comp,
      COALESCE(SUM(CASE WHEN o.payment_status='unpaid' THEN o.total END),0) AS unpaid,
      COALESCE(SUM(CASE WHEN o.payment_method='tab' THEN o.total END),0) AS on_tab,
      COALESCE(SUM(CASE WHEN ${SALE} THEN o.discount END),0) AS discounts
    ${BASE}`).get(...a);
  const items_sold = db.prepare(`SELECT COALESCE(SUM(oi.qty),0) AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.local_day BETWEEN ? AND ? AND o.status != 'cancelled'`).get(...a).n;
  const cancelled = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS value FROM orders
    WHERE local_day BETWEEN ? AND ? AND status = 'cancelled'`).get(...a);

  const group = (expr, order = "sales DESC") => db.prepare(`SELECT ${expr} AS key, COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN ${SALE} THEN o.total END),0) AS sales, COALESCE(SUM(o.total),0) AS gross
    ${BASE} GROUP BY key ORDER BY ${order}`).all(...a);

  const items = db.prepare(`SELECT oi.name AS name, oi.category_name AS category,
      SUM(oi.qty) AS qty,
      COALESCE(SUM(CASE WHEN ${SALE} THEN oi.line_total END),0) AS sales,
      COALESCE(SUM(CASE WHEN o.payment_method='free' THEN oi.qty END),0) AS comp_qty,
      SUM(CASE WHEN o.source='room' THEN oi.qty ELSE 0 END) AS room_qty,
      SUM(CASE WHEN o.source='counter' THEN oi.qty ELSE 0 END) AS counter_qty
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.local_day BETWEEN ? AND ? AND o.status != 'cancelled'
    GROUP BY oi.name, oi.category_name ORDER BY qty DESC, sales DESC`).all(...a);

  const categories = db.prepare(`SELECT oi.category_name AS key, SUM(oi.qty) AS qty,
      COALESCE(SUM(CASE WHEN ${SALE} THEN oi.line_total END),0) AS sales
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.local_day BETWEEN ? AND ? AND o.status != 'cancelled'
    GROUP BY oi.category_name ORDER BY sales DESC`).all(...a);

  const tabPayments = db.prepare(`SELECT method AS key, COUNT(*) AS n, SUM(amount) AS amount FROM tab_payments
    WHERE local_day BETWEEN ? AND ? GROUP BY method`).all(...a);

  // Average prep time (new → ready), minutes.
  const prep = db.prepare(`SELECT AVG((julianday(ready_at) - julianday(created_at)) * 1440) AS m
    ${BASE} AND o.ready_at IS NOT NULL`).get(...a).m;

  return {
    from, to,
    totals: { ...totals, items_sold, cancelled_orders: cancelled.n, cancelled_value: cancelled.value,
      avg_order: totals.orders ? Math.round(totals.sales / totals.orders) : 0,
      avg_prep_min: prep ? Math.round(prep * 10) / 10 : null },
    byPayment: group("COALESCE(o.payment_method,'unpaid')"),
    bySource: group("o.source"),
    byRoom: group("COALESCE(o.room_name,'Counter')"),
    byDay: group("o.local_day", "key ASC"),
    byHour: group("o.local_hour", "key ASC"),
    byCustomer: group("NULLIF(o.customer_name,'')").filter((r) => r.key).slice(0, 50),
    byDiscount: db.prepare(`SELECT o.discount_code AS key, COUNT(*) AS orders, COALESCE(SUM(o.discount),0) AS discount,
        COALESCE(SUM(o.total),0) AS sales
      ${BASE} AND o.discount_code IS NOT NULL GROUP BY o.discount_code COLLATE NOCASE ORDER BY orders DESC`).all(...a),
    byStaff: db.prepare(`SELECT COALESCE(u.name,'(room order)') AS key, COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN ${SALE} THEN o.total END),0) AS sales
      FROM orders o LEFT JOIN users u ON u.id = o.created_by
      WHERE o.local_day BETWEEN ? AND ? AND o.status != 'cancelled' GROUP BY key ORDER BY sales DESC`).all(...a),
    items,
    categories,
    tabPayments,
  };
}

function csv(rows, cols) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.map((c) => esc(c[0])).join(","), ...rows.map((r) => cols.map((c) => esc(c[1](r))).join(","))].join("\r\n");
}
const sar = (h) => (h / 100).toFixed(2);

export function itemsCsv(from, to) {
  const { items } = summary(from, to);
  return csv(items, [
    ["Item", (r) => r.name], ["Category", (r) => r.category], ["Qty", (r) => r.qty],
    ["Counter Qty", (r) => r.counter_qty], ["Room Qty", (r) => r.room_qty], ["Comp Qty", (r) => r.comp_qty],
    ["Sales (SAR)", (r) => sar(r.sales)],
  ]);
}

export function ordersCsv(from, to) {
  const rows = db.prepare(`SELECT o.*, u.name AS staff,
      (SELECT GROUP_CONCAT(oi.qty || 'x ' || oi.name || CASE WHEN oi.options_text != '' THEN ' (' || oi.options_text || ')' ELSE '' END, '; ')
         FROM order_items oi WHERE oi.order_id = o.id) AS lines
    FROM orders o LEFT JOIN users u ON u.id = o.created_by
    WHERE o.local_day BETWEEN ? AND ? ORDER BY o.id`).all(from, to);
  return csv(rows, [
    ["Day", (r) => r.local_day], ["Order #", (r) => r.number], ["Created (UTC)", (r) => r.created_at],
    ["Source", (r) => r.source], ["Room", (r) => r.room_name], ["Customer", (r) => r.customer_name],
    ["Items", (r) => r.lines], ["Subtotal (SAR)", (r) => sar(r.subtotal ?? r.total)], ["Discount (SAR)", (r) => sar(r.discount || 0)],
    ["Discount code", (r) => r.discount_code], ["Total (SAR)", (r) => sar(r.total)], ["Status", (r) => r.status],
    ["Payment", (r) => r.payment_status], ["Method", (r) => r.payment_method], ["Tab", (r) => r.tab_name],
    ["Staff", (r) => r.staff], ["Note", (r) => r.note], ["Cancel reason", (r) => r.cancel_reason],
  ]);
}
