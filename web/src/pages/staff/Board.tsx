// Barista / orders board: live columns + history and unpaid list.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Ban, Banknote, DoorOpen, Printer, RotateCcw, Store, Undo2 } from "lucide-react";
import { api, type Order, type OrderStatus, type PayMethod } from "../../lib/api";
import { useStaff } from "./StaffContext";
import { Money } from "../../components/Money";
import { PayDialog } from "../../components/PayDialog";
import { useToast } from "../../components/Toast";
import { addDays, clock, PAY_LABEL, STATUS_LABEL, timeAgo } from "../../lib/format";

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  new: { to: "preparing", label: "Start" },
  preparing: { to: "ready", label: "Ready" },
  ready: { to: "completed", label: "Delivered" },
};

export default function Board() {
  const { orders, settings, reloadSettings } = useStaff();
  const [view, setView] = useState<"live" | "unpaid" | "history">("live");
  const [filter, setFilter] = useState<"all" | "room" | "counter">("all");
  const [, tick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(iv);
  }, []);

  const open = settings?.roomOrdering === "open";
  const pass = (o: Order) => filter === "all" || o.source === filter;
  const live = orders.filter((o) => ["new", "preparing", "ready"].includes(o.status) && pass(o));
  const unpaid = orders.filter((o) => o.payment_status === "unpaid" && o.status !== "cancelled" && pass(o));

  const toggleRooms = async () => {
    await api("/api/settings/room-ordering", { body: { open: !open } });
    reloadSettings();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
        {(["live", "unpaid", "history"] as const).map((v) => (
          <button key={v} className={`btn text-sm ${view === v ? "btn-primary" : ""}`} onClick={() => setView(v)}>
            {v === "live" ? `Live (${live.length})` : v === "unpaid" ? `Unpaid (${unpaid.length})` : "History"}
          </button>
        ))}
        <span className="w-px h-6 bg-border mx-1" />
        {(["all", "room", "counter"] as const).map((f) => (
          <button key={f} className={`btn text-sm ${filter === f ? "btn-dark" : "btn-ghost"}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "room" ? "Rooms" : "Walk-in"}
          </button>
        ))}
        <div className="flex-1" />
        <button className={`btn text-sm ${open ? "btn-ghost" : "btn-danger"}`} onClick={() => void toggleRooms()}>
          <DoorOpen size={16} /> Room orders: {open ? "Open" : "Closed"}
        </button>
      </div>

      {view === "live" && (
        <div className="flex-1 min-h-0 grid grid-cols-3 gap-3 p-3">
          {(["new", "preparing", "ready"] as const).map((s) => {
            const list = live.filter((o) => o.status === s).sort((a, b) => a.id - b.id);
            return (
              <section key={s} className="flex flex-col min-h-0 bg-panel-3/60 rounded-[1.5rem]">
                <h2 className="text-2xl px-4 pt-3 pb-2 flex items-center gap-2">
                  <span className={`h-3.5 w-3.5 rounded-full ${s === "new" ? "bg-primary" : s === "preparing" ? "bg-blue" : "bg-cyan"}`} />
                  {STATUS_LABEL[s]} <span className="chip bg-panel text-ink text-sm">{list.length}</span>
                </h2>
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                  {list.map((o) => <OrderCard key={o.id} o={o} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {view === "unpaid" && (
        <div className="flex-1 overflow-y-auto p-3 grid gap-2 content-start grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {unpaid.length === 0 && <div className="text-muted p-6">Nothing unpaid.</div>}
          {unpaid.map((o) => <OrderCard key={o.id} o={o} />)}
        </div>
      )}
      {view === "history" && <History filter={pass} />}
    </div>
  );
}

function History({ filter }: { filter: (o: Order) => boolean }) {
  const { orders } = useStaff();
  const [day, setDay] = useState<string>("");
  const [list, setList] = useState<Order[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    void api<{ day: string }>("/api/today").then((r) => setDay(r.day));
  }, []);
  useEffect(() => {
    if (day) void api<Order[]>(`/api/orders?day=${day}`).then(setList);
  }, [day, orders]);
  const s = q.trim().toLowerCase();
  const shown = (list || []).filter(filter).filter((o) =>
    !s || String(o.number) === s || o.customer_name.toLowerCase().includes(s) || (o.room_name || "").toLowerCase().includes(s));
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 p-3">
        <button className="btn" onClick={() => setDay((d) => addDays(d, -1))}>‹</button>
        <input type="date" className="input w-44" value={day} onChange={(e) => setDay(e.target.value)} />
        <button className="btn" onClick={() => setDay((d) => addDays(d, 1))}>›</button>
        <input className="input w-60" placeholder="Search # / name / room" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-muted text-sm">{shown.length} orders</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3 grid gap-2 content-start grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
        {shown.map((o) => <OrderCard key={o.id} o={o} />)}
      </div>
    </div>
  );
}

function OrderCard({ o }: { o: Order }) {
  const { upsertOrder, printOrder, people, user, reloadPeople } = useStaff();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = NEXT[o.status];
  const age = useMemo(() => timeAgo(o.created_at), [o.created_at, o.updated_at]); // eslint-disable-line
  const late = o.status !== "ready" && ["new", "preparing"].includes(o.status) && Date.now() - new Date(o.created_at).getTime() > 10 * 60_000;

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      upsertOrder(await api<Order>(`/api/orders/${o.id}/${path}`, { body }));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally { setBusy(false); }
  };
  const pay = async (p: { method: PayMethod; tabName?: string } | null) => {
    if (!p) return setPaying(false);
    await act("pay", p);
    if (p.method === "tab") reloadPeople();
    setPaying(false);
  };
  const cancel = () => {
    const reason = prompt(`Cancel order #${o.number}? Reason:`);
    if (reason !== null) void act("status", { status: "cancelled", reason });
  };

  return (
    <div className={`card p-4 shadow-sm ${o.status === "new" ? "border-primary border-2" : ""} ${o.status === "cancelled" ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="font-stat text-4xl leading-none">#{o.number}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-sm font-semibold truncate">
            {o.source === "room" ? <DoorOpen size={14} className="text-secondary shrink-0" /> : <Store size={14} className="text-muted shrink-0" />}
            <span className={o.source === "room" ? "text-secondary font-extrabold" : "text-muted"}>{o.room_name || "Walk-in"}</span>
          </div>
          {o.customer_name && <div className="text-sm truncate">{o.customer_name}</div>}
        </div>
        <div className="text-right text-xs">
          <div className={late ? "text-danger font-bold" : "text-muted"}>{age}</div>
          <div className="text-muted">{clock(o.created_at)}</div>
        </div>
      </div>

      <ul className="mt-2 space-y-0.5">
        {o.items.map((i) => (
          <li key={i.id} className="text-[15px]">
            <b className="font-stat">{i.qty}×</b> {i.name}
            {i.options_text && <span className="text-primary font-extrabold"> · {i.options_text}</span>}
            {i.note && <span className="text-secondary"> · “{i.note}”</span>}
          </li>
        ))}
      </ul>
      {o.note && <div className="mt-2 text-sm font-bold bg-yellow text-ink rounded-xl px-3 py-1.5">Note: {o.note}</div>}
      {o.status === "cancelled" && <div className="mt-1 text-sm text-danger">Cancelled{o.cancel_reason ? `: ${o.cancel_reason}` : ""}</div>}

      <div className="mt-2 flex items-center gap-2 text-sm">
        <Money v={o.total} className="font-semibold" />
        {o.discount_code && <span className="chip bg-yellow text-ink" title={`Discount −${o.discount / 100}`}>{o.discount_code}</span>}
        {o.payment_status === "paid" ? (
          <span className="chip bg-cyan text-ink">
            {PAY_LABEL[o.payment_method || ""]}{o.tab_name ? ` · ${o.tab_name}` : ""}
          </span>
        ) : (
          <span className="chip bg-red/10 text-danger">
            Unpaid{o.pay_pref ? ` · wants ${PAY_LABEL[o.pay_pref]}` : ""}
          </span>
        )}
        {o.status === "completed" && <span className="text-muted">Done</span>}
      </div>

      <div className="mt-3 flex gap-2">
        {next && (
          <button className={`btn flex-1 py-3 ${o.status === "new" ? "btn-primary" : o.status === "preparing" ? "btn-blue" : "btn-ok"}`}
            disabled={busy} onClick={() => void act("status", { status: next.to })}>
            {next.label} <ArrowRight size={16} />
          </button>
        )}
        {o.payment_status === "unpaid" && o.status !== "cancelled" && (
          <button className="btn py-3" disabled={busy} onClick={() => setPaying(true)}><Banknote size={16} /> Pay</button>
        )}
        <button className="btn py-3 px-3" onClick={() => printOrder(o.id)} aria-label="Print"><Printer size={16} /></button>
        {o.status === "completed" && (
          <button className="btn py-3 px-3" title="Reopen" onClick={() => void act("status", { status: "ready" })}><RotateCcw size={16} /></button>
        )}
        {o.payment_status === "paid" && user.role === "admin" && o.status !== "cancelled" && (
          <button className="btn py-3 px-3" title="Undo payment" onClick={() => confirm("Mark as unpaid?") && void act("unpay", {})}><Undo2 size={16} /></button>
        )}
        {o.status !== "cancelled" && (
          <button className="btn btn-ghost py-3 px-3 text-danger" title="Cancel" onClick={cancel}><Ban size={16} /></button>
        )}
      </div>

      {paying && (
        <PayDialog
          title={`Order #${o.number}`}
          total={o.total}
          people={people}
          defaultTab={o.customer_name}
          preferred={o.pay_pref}
          busy={busy}
          onClose={() => setPaying(false)}
          onPay={(p) => void pay(p)}
        />
      )}
    </div>
  );
}
