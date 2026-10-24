// Employee tabs: balances, history, settle.
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useStaff } from "./StaffContext";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { getSocket } from "../../lib/realtime";
import { PAY_LABEL } from "../../lib/format";

type TabRow = { name: string; charged: number; paid: number; balance: number; orders: number; last: string };
type Detail = {
  name: string; balance: number;
  orders: { id: number; number: number; local_day: string; total: number; room_name: string | null; lines: string }[];
  payments: { id: number; amount: number; method: string; note: string; created_at: string; user_name: string | null }[];
};

export default function Tabs() {
  const { orders, user } = useStaff();
  const toast = useToast();
  const [rows, setRows] = useState<TabRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showZero, setShowZero] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");

  const load = () => void api<TabRow[]>("/api/tabs").then(setRows);
  const loadDetail = (n: string) => void api<Detail>(`/api/tabs/${encodeURIComponent(n)}`).then((d) => {
    setDetail(d);
    setAmount(d.balance > 0 ? String(d.balance / 100) : "");
  });
  useEffect(load, [orders]);
  useEffect(() => {
    const s = getSocket();
    s.on("tabs-changed", load);
    return () => { s.off("tabs-changed", load); };
  }, []);
  useEffect(() => { if (sel) loadDetail(sel); }, [sel, orders]);

  const settle = async () => {
    try {
      await api(`/api/tabs/${encodeURIComponent(sel!)}/pay`, { body: { amount: Math.round(Number(amount) * 100), method, note } });
      toast("Payment recorded", "ok");
      setNote("");
      load(); loadDetail(sel!);
    } catch (e) { toast((e as Error).message, "err"); }
  };

  const shown = rows.filter((r) => showZero || r.balance !== 0);
  const owed = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);

  return (
    <div className="h-full flex">
      <div className="w-[380px] border-r border-border flex flex-col">
        <div className="p-3 border-b border-border">
          <div className="text-sm text-muted">Total owed</div>
          <Money v={owed} className="text-4xl" />
          <label className="flex items-center gap-2 text-sm mt-2">
            <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> Show settled tabs
          </label>
        </div>
        <div className="flex-1 overflow-y-auto">
          {shown.length === 0 && <div className="p-6 text-muted">No open tabs.</div>}
          {shown.map((r) => (
            <button key={r.name} onClick={() => setSel(r.name)}
              className={`w-full flex items-center px-3 py-3 border-b border-border text-left ${sel === r.name ? "bg-panel-3" : ""}`}>
              <div className="flex-1">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-muted">{r.orders} orders</div>
              </div>
              <Money v={r.balance} className={r.balance > 0 ? "text-warn" : "text-ok"} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {!detail ? <div className="text-muted">Pick a tab.</div> : (
          <>
            <h1 className="text-4xl">{detail.name}</h1>
            <div className="text-muted">Balance <Money v={detail.balance} className="text-2xl text-ink" /></div>
            <div className="card p-4 mt-4 flex flex-wrap items-end gap-2">
              <div>
                <div className="text-xs text-muted mb-1">Amount</div>
                <input className="input w-32 font-stat" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Method</div>
                <select className="input w-36" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="cash">Cash</option><option value="card">Card</option><option value="payroll">Payroll deduction</option>
                  {user.role === "admin" && <option value="writeoff">Write-off</option>}
                </select>
              </div>
              <input className="input flex-1 min-w-40" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn btn-ok" disabled={!(Number(amount) > 0)} onClick={() => void settle()}>Record payment</button>
            </div>
            <div className="grid lg:grid-cols-2 gap-4 mt-4">
              <div>
                <h3 className="text-xl mb-2">Charges</h3>
                {detail.orders.map((o) => (
                  <div key={o.id} className="flex gap-3 py-2 border-b border-border text-sm">
                    <span className="text-muted w-24">{o.local_day}</span>
                    <span className="flex-1">#{o.number} {o.room_name ? `· ${o.room_name}` : ""}<br /><span className="text-muted">{o.lines}</span></span>
                    <Money v={o.total} />
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-xl mb-2">Payments</h3>
                {detail.payments.length === 0 && <div className="text-muted text-sm">None yet.</div>}
                {detail.payments.map((p) => (
                  <div key={p.id} className="flex gap-3 py-2 border-b border-border text-sm">
                    <span className="text-muted w-24">{p.created_at.slice(0, 10)}</span>
                    <span className="flex-1">{PAY_LABEL[p.method] || p.method}{p.note ? ` · ${p.note}` : ""}<br /><span className="text-muted">{p.user_name}</span></span>
                    <Money v={p.amount} className="text-ok" />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
