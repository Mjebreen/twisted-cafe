// Admin: activity log (who did what, when). Updates live.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { api } from "../../lib/api";
import { getSocket } from "../../lib/realtime";
import { BiTitle } from "../../components/Brand";

type Log = { id: number; at: string; local_day: string; user_id: number | null; actor: string; category: string; message: string; ip: string; ok: number };

const CATS: { id: string; label: string; cls: string }[] = [
  { id: "order", label: "Orders", cls: "bg-primary text-white" },
  { id: "payment", label: "Payments", cls: "bg-cyan text-ink" },
  { id: "tab", label: "Tabs", cls: "bg-blue text-white" },
  { id: "menu", label: "Menu", cls: "bg-yellow text-ink" },
  { id: "room", label: "Rooms", cls: "bg-ink text-white" },
  { id: "auth", label: "Sign-ins", cls: "bg-panel-3 text-ink" },
  { id: "team", label: "Team", cls: "bg-panel-3 text-ink" },
  { id: "settings", label: "Settings", cls: "bg-panel-3 text-ink" },
  { id: "report", label: "Exports", cls: "bg-panel-3 text-ink" },
  { id: "system", label: "System", cls: "bg-panel-3 text-ink" },
];
const catOf = (id: string) => CATS.find((c) => c.id === id) || { id, label: id, cls: "bg-panel-3 text-ink" };

export default function Logs() {
  const [rows, setRows] = useState<Log[]>([]);
  const [cat, setCat] = useState("");
  const [day, setDay] = useState("");
  const [q, setQ] = useState("");
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(true);

  const query = useCallback((before?: number) => {
    const p = new URLSearchParams({ limit: "100" });
    if (cat) p.set("category", cat);
    if (day) p.set("day", day);
    if (q.trim()) p.set("q", q.trim());
    if (failed) p.set("failed", "1");
    if (before) p.set("before", String(before));
    return api<Log[]>(`/api/logs?${p}`);
  }, [cat, day, q, failed]);

  const load = useCallback(() => {
    void query().then((r) => { setRows(r); setMore(r.length === 100); });
  }, [query]);
  useEffect(() => {
    const t = setTimeout(load, 200); // debounce typing in search
    return () => clearTimeout(t);
  }, [load]);

  // Live: new entries appear at the top when they match the current filters.
  useEffect(() => {
    const s = getSocket();
    const onLog = (l: Log) => {
      if (cat && l.category !== cat) return;
      if (day && l.local_day !== day) return;
      if (failed && l.ok) return;
      if (q.trim() && !`${l.message} ${l.actor}`.toLowerCase().includes(q.trim().toLowerCase())) return;
      setRows((r) => (r.some((x) => x.id === l.id) ? r : [l, ...r]));
    };
    s.on("log", onLog);
    return () => { s.off("log", onLog); };
  }, [cat, day, q, failed]);

  // Group rows by day for readability.
  const groups: { day: string; rows: Log[] }[] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.day === r.local_day) g.rows.push(r);
    else groups.push({ day: r.local_day, rows: [r] });
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-end gap-4 flex-wrap">
        <BiTitle en="Activity log" ar="سجل النشاط" size="text-4xl" />
        <div className="flex-1" />
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9 w-64 py-2" placeholder="Search name, order #, item…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <input type="date" className="input w-44 py-2" value={day} onChange={(e) => setDay(e.target.value)} />
        <button className="btn" onClick={load} aria-label="Refresh"><RefreshCw size={16} /></button>
      </div>

      <div className="flex gap-2 flex-wrap mt-4">
        <button className={`btn text-sm py-1.5 ${!cat ? "btn-dark" : "bg-panel border-border"}`} onClick={() => setCat("")}>All</button>
        {CATS.map((c) => (
          <button key={c.id} className={`btn text-sm py-1.5 ${cat === c.id ? "btn-dark" : "bg-panel border-border"}`} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
        <button className={`btn text-sm py-1.5 ${failed ? "btn-danger bg-red/10" : "bg-panel border-border"}`} onClick={() => setFailed((v) => !v)}>
          <AlertTriangle size={14} /> Failed attempts
        </button>
      </div>

      <div className="mt-4 space-y-5">
        {groups.map((g) => (
          <section key={g.day}>
            <div className="eyebrow mb-2">{new Date(`${g.day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short", year: "numeric" })}</div>
            <div className="card divide-y divide-border overflow-hidden">
              {g.rows.map((r) => {
                const c = catOf(r.category);
                return (
                  <div key={r.id} className={`flex items-start gap-3 px-4 py-2.5 ${r.ok ? "" : "bg-red/5"}`}>
                    <span className="font-stat text-sm text-muted w-20 shrink-0 pt-0.5 whitespace-nowrap">
                      {new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={`chip shrink-0 w-20 justify-center ${c.cls}`}>{c.label}</span>
                    <span className="flex-1 min-w-0">
                      {!r.ok && <AlertTriangle size={14} className="inline text-danger mr-1 -mt-0.5" />}
                      <span className={`font-semibold ${r.ok ? "" : "text-danger"}`}>{r.message}</span>
                    </span>
                    <span className="text-sm font-extrabold shrink-0 max-w-[10rem] truncate">{r.actor || "—"}</span>
                    <span className="text-xs text-muted shrink-0 w-24 text-right hidden lg:block pt-0.5">{/^(::1|127.0.0.1|::ffff:127.0.0.1)$/.test(r.ip) ? "this PC" : r.ip.replace(/^::ffff:/, "")}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {rows.length === 0 && <div className="card p-8 text-center text-muted font-bold">No activity matches.</div>}
        {more && rows.length > 0 && (
          <button className="btn w-full" onClick={() => void query(rows[rows.length - 1].id).then((r) => { setRows((x) => [...x, ...r]); setMore(r.length === 100); })}>
            Load older
          </button>
        )}
      </div>
    </div>
  );
}
