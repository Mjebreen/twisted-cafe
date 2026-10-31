// Sales reports: KPIs, sales by item, category, payment, source, room, hour, day, staff.
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../../lib/api";
import { Money } from "../../components/Money";
import { BiTitle } from "../../components/Brand";
import { addDays, fmt, PAY_LABEL } from "../../lib/format";

type G = { key: string | number; orders: number; sales: number; gross?: number };
type ItemRow = { name: string; category: string; qty: number; sales: number; comp_qty: number; room_qty: number; counter_qty: number };
type Summary = {
  from: string; to: string;
  totals: { orders: number; sales: number; comp: number; unpaid: number; on_tab: number; items_sold: number;
    cancelled_orders: number; cancelled_value: number; avg_order: number; avg_prep_min: number | null; discounts: number; rewards: number };
  byPayment: G[]; bySource: G[]; byRoom: G[]; byDay: G[]; byHour: G[]; byStaff: G[]; byCustomer: G[];
  items: ItemRow[]; categories: { key: string; qty: number; sales: number }[];
  tabPayments: { key: string; n: number; amount: number }[];
  byDiscount: { key: string; orders: number; discount: number; sales: number }[];
};

export default function Reports() {
  const [today, setToday] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Summary | null>(null);
  const [sort, setSort] = useState<"qty" | "sales" | "name">("qty");

  useEffect(() => {
    void api<{ day: string }>("/api/today").then((r) => { setToday(r.day); setFrom(r.day); setTo(r.day); });
  }, []);
  useEffect(() => {
    if (from && to) void api<Summary>(`/api/reports/summary?from=${from}&to=${to}`).then(setData);
  }, [from, to]);

  const presets = today ? [
    ["Today", today, today],
    ["Yesterday", addDays(today, -1), addDays(today, -1)],
    ["Last 7 days", addDays(today, -6), today],
    ["Last 30 days", addDays(today, -29), today],
    ["This month", `${today.slice(0, 8)}01`, today],
  ] as const : [];

  const items = useMemo(() => {
    const l = [...(data?.items || [])];
    if (sort === "name") l.sort((a, b) => a.name.localeCompare(b.name));
    else l.sort((a, b) => b[sort] - a[sort]);
    return l;
  }, [data, sort]);

  const t = data?.totals;
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        {presets.map(([label, f, tt]) => (
          <button key={label} className={`btn text-sm ${from === f && to === tt ? "btn-primary" : ""}`} onClick={() => { setFrom(f); setTo(tt); }}>{label}</button>
        ))}
        <input type="date" className="input w-40 py-2" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-muted">to</span>
        <input type="date" className="input w-40 py-2" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="flex-1" />
        <a className="btn text-sm" href={`/api/reports/items.csv?from=${from}&to=${to}`}><Download size={16} /> Items CSV</a>
        <a className="btn text-sm" href={`/api/reports/orders.csv?from=${from}&to=${to}`}><Download size={16} /> Orders CSV</a>
      </div>

      {t && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-3 mt-4">
            <Stat label="Sales" big><Money v={t.sales} /></Stat>
            <Stat label="Orders">{t.orders}</Stat>
            <Stat label="Avg order"><Money v={t.avg_order} /></Stat>
            <Stat label="Items sold">{t.items_sold}</Stat>
            <Stat label="On tabs"><Money v={t.on_tab} /></Stat>
            <Stat label="Unpaid" warn={t.unpaid > 0}><Money v={t.unpaid} /></Stat>
            <Stat label="Discounts"><Money v={t.discounts + (t.rewards || 0)} />{t.rewards > 0 && <div className="text-xs text-muted font-semibold">incl. <Money v={t.rewards} /> points</div>}</Stat>
            <Stat label="Free / comp"><Money v={t.comp} /></Stat>
            <Stat label="Avg prep">{t.avg_prep_min != null ? `${t.avg_prep_min} min` : "–"}</Stat>
          </div>
          {t.cancelled_orders > 0 && (
            <div className="text-sm text-muted mt-2">{t.cancelled_orders} cancelled order(s) worth {fmt(t.cancelled_value)} not counted.</div>
          )}

          <div className="grid xl:grid-cols-3 gap-4 mt-4">
            <div className="card p-4 xl:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <BiTitle en="Sales by item" ar="المبيعات حسب الصنف" size="text-2xl" />
                <select className="input w-36 py-1 text-sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="qty">Sort: qty</option><option value="sales">Sort: sales</option><option value="name">Sort: name</option>
                </select>
              </div>
              <table className="w-full text-sm">
                <thead className="text-muted text-left">
                  <tr><th className="py-1">Item</th><th>Category</th><th className="text-right">Qty</th><th className="text-right">Counter</th><th className="text-right">Rooms</th><th className="text-right">Comp</th><th className="text-right" title="Before order discounts">Sales*</th><th className="w-1/5"></th></tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.name + i.category} className="border-t border-border">
                      <td className="py-1.5 font-semibold">{i.name}</td>
                      <td className="text-muted">{i.category}</td>
                      <td className="text-right font-stat">{i.qty}</td>
                      <td className="text-right font-stat text-muted">{i.counter_qty}</td>
                      <td className="text-right font-stat text-muted">{i.room_qty}</td>
                      <td className="text-right font-stat text-muted">{i.comp_qty || ""}</td>
                      <td className="text-right"><Money v={i.sales} /></td>
                      <td className="pl-3"><Bar v={i[sort === "name" ? "qty" : sort]} max={Math.max(...items.map((x) => x[sort === "name" ? "qty" : sort]))} /></td>
                    </tr>
                  ))}
                  {items.length === 0 && <tr><td colSpan={8} className="text-muted py-4">No sales in this range.</td></tr>}
                  {items.length > 0 && t.discounts > 0 && <tr><td colSpan={8} className="text-xs text-muted pt-3">* Item sales are before order discounts. Total discounts in this range: {fmt(t.discounts)}.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="space-y-4">
              <GroupTable title="By category" rows={data.categories.map((c) => ({ key: c.key, orders: c.qty, sales: c.sales }))} countLabel="Qty" />
              <GroupTable title="By payment" rows={data.byPayment.map((r) => ({ ...r, key: PAY_LABEL[String(r.key)] || r.key }))} useGross />
              <GroupTable title="Walk-in vs rooms" rows={data.bySource.map((r) => ({ ...r, key: r.key === "room" ? "Room orders" : "Walk-in" }))} />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
            <GroupTable title="By room" rows={data.byRoom} />
            <GroupTable title="By hour" rows={data.byHour.map((r) => ({ ...r, key: `${String(r.key).padStart(2, "0")}:00` }))} keepOrder />
            <GroupTable title="By day" rows={data.byDay} keepOrder />
            <GroupTable title="By staff (rang up)" rows={data.byStaff} />
            <GroupTable title="Top customers" rows={data.byCustomer.slice(0, 15)} />
            {data.byDiscount.length > 0 && (
              <GroupTable title="Discount codes (amount off)" rows={data.byDiscount.map((r) => ({ key: r.key, orders: r.orders, sales: r.discount }))} countLabel="Uses" />
            )}
            {data.tabPayments.length > 0 && (
              <GroupTable title="Tab payments received" rows={data.tabPayments.map((r) => ({ key: PAY_LABEL[r.key] || r.key, orders: r.n, sales: r.amount }))} countLabel="#" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, children, big, warn }: { label: string; children: React.ReactNode; big?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-[1.25rem] p-4 ${big ? "bg-primary text-white" : "card"}`}>
      <div className={`eyebrow ${big ? "text-white/80" : ""}`}>{label}</div>
      <div className={`font-stat mt-1 text-3xl ${warn ? "text-danger" : ""}`}>{children}</div>
    </div>
  );
}

// Single-series magnitude bar: one hue, value shown as text beside it.
function Bar({ v, max }: { v: number; max: number }) {
  const w = max > 0 ? Math.max(2, (v / max) * 100) : 0;
  return (
    <div className="h-2.5 bg-panel-3 rounded-r" title={String(v)}>
      <div className="h-full bg-primary rounded-r" style={{ width: `${w}%` }} />
    </div>
  );
}

function GroupTable({ title, rows, countLabel = "Orders", keepOrder, useGross }: {
  title: string; rows: G[]; countLabel?: string; keepOrder?: boolean; useGross?: boolean;
}) {
  const val = (r: G) => (useGross ? r.gross ?? r.sales : r.sales);
  const list = keepOrder ? rows : [...rows].sort((a, b) => val(b) - val(a));
  const max = Math.max(0, ...list.map(val));
  return (
    <div className="card p-4">
      <h3 className="text-xl mb-2">{title}</h3>
      {list.length === 0 && <div className="text-muted text-sm">No data.</div>}
      <table className="w-full text-sm">
        {list.length > 0 && <thead className="text-muted text-left"><tr><th></th><th className="text-right">{countLabel}</th><th className="text-right">{useGross ? "Amount" : "Sales"}</th></tr></thead>}
        <tbody>
          {list.map((r) => (
            <tr key={String(r.key)} className="border-t border-border" title={`${r.key}: ${fmt(val(r))}`}>
              <td className="py-1.5 pr-2">
                <div className="truncate max-w-[12rem]">{r.key}</div>
                <Bar v={val(r)} max={max} />
              </td>
              <td className="text-right font-stat text-muted align-top pt-1.5">{r.orders}</td>
              <td className="text-right align-top pt-1.5"><Money v={val(r)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
