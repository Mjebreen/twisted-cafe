// Staff-only employee reward points: balances, history, manual add/remove, and (admin) settings.
import { useEffect, useMemo, useState } from "react";
import { Gift, Minus, Plus, Search } from "lucide-react";
import { api } from "../../lib/api";
import { useStaff } from "./StaffContext";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { getSocket } from "../../lib/realtime";
import { timeAgo } from "../../lib/format";
import { NameInput } from "../../components/NameInput";

type Row = { name: string; balance: number; earned: number; spent: number; last: string };
type Config = { enabled: boolean; earnPerSar: number; pointsPerSar: number };
type Hist = {
  name: string; balance: number;
  rows: { id: number; points: number; kind: "earn" | "redeem" | "adjust"; note: string; created_at: string; user_name: string | null;
    order_number: number | null; order_day: string | null; order_total: number | null }[];
};

const KIND: Record<string, string> = { earn: "Earned", redeem: "Used", adjust: "Changed by hand" };

export default function Rewards() {
  const { user, orders, people, settings, reloadSettings, reloadPeople } = useStaff();
  const admin = user.role === "admin";
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [hist, setHist] = useState<Hist | null>(null);
  const [pts, setPts] = useState("");
  const [note, setNote] = useState("");
  const [addName, setAddName] = useState("");

  const load = () => void api<{ config: Config; balances: Row[] }>("/api/rewards").then((r) => { setRows(r.balances); setCfg(r.config); });
  const loadHist = (n: string) => void api<Hist>(`/api/rewards/${encodeURIComponent(n)}`).then(setHist);
  useEffect(load, [orders, settings]);
  useEffect(() => {
    const s = getSocket();
    s.on("rewards-changed", load);
    return () => { s.off("rewards-changed", load); };
  }, []);
  useEffect(() => { if (sel) loadHist(sel); else setHist(null); }, [sel, orders, rows]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => !s || r.name.toLowerCase().includes(s));
  }, [rows, q]);
  const outstanding = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  const value = (p: number) => (cfg ? Math.floor((p * 100) / cfg.pointsPerSar) : 0);

  const adjust = async (name: string, sign: 1 | -1) => {
    const n = Math.trunc(Number(pts));
    if (!(n > 0)) return toast("Enter a number of points", "err");
    try {
      const r = await api<{ balance: number }>(`/api/rewards/${encodeURIComponent(name)}/adjust`, { body: { points: sign * n, note } });
      toast(`${sign > 0 ? "Added" : "Removed"} ${n} points. ${name} now has ${r.balance}.`, "ok");
      setPts(""); setNote(""); setAddName("");
      setSel(name); load(); loadHist(name);
    } catch (e) { toast((e as Error).message, "err"); }
  };

  return (
    <div className="h-full flex">
      <div className="w-[380px] border-r border-border flex flex-col">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-end justify-between">
            <div>
              <div className="ar text-primary font-extrabold text-sm">نقاط الموظفين</div>
              <h1 className="text-3xl leading-none">Rewards</h1>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted font-bold">Points out there</div>
              <div className="font-stat text-xl">{outstanding.toLocaleString()}</div>
              <div className="text-xs text-muted">worth <Money v={value(outstanding)} /></div>
            </div>
          </div>
          {cfg && !cfg.enabled && <div className="chip bg-yellow text-ink">Rewards are off. No points are earned or used.</div>}
          {cfg && cfg.enabled && (
            <div className="text-xs text-muted font-semibold">
              {cfg.earnPerSar} point{cfg.earnPerSar === 1 ? "" : "s"} per SAR paid · {cfg.pointsPerSar} points = SAR 1 off
            </div>
          )}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input py-2 pl-9" placeholder="Search employee" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {shown.map((r) => (
            <button key={r.name} onClick={() => setSel(r.name)}
              className={`w-full text-left px-4 py-3 border-b border-border flex items-center gap-3 ${sel?.toLowerCase() === r.name.toLowerCase() ? "bg-primary/10" : "hover:bg-panel-2"}`}>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold truncate">{r.name}</div>
                <div className="text-xs text-muted font-semibold">earned {r.earned} · used {r.spent} · {timeAgo(r.last)} ago</div>
              </div>
              <div className="text-right">
                <div className="font-stat text-lg">{r.balance}</div>
                <div className="text-xs text-muted"><Money v={value(r.balance)} /></div>
              </div>
            </button>
          ))}
          {rows.length === 0 && <div className="p-6 text-muted text-sm">No points yet. Employees earn points when an order with their name is paid.</div>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {admin && <RewardSettings onSaved={() => { reloadSettings(); load(); }} />}

        {admin && !sel && (
          <div className="card p-4">
            <div className="eyebrow">Give points by hand</div>
            <p className="text-sm text-muted font-semibold">For a bonus, a birthday, or to fix a mistake. Open an employee on the left to see their history.</p>
            <div className="flex gap-2 mt-2 flex-wrap">
              <div className="flex-1 min-w-40"><NameInput value={addName} onChange={setAddName} names={people} placeholder="Employee name" onOpen={reloadPeople} /></div>
              <input className="input w-28 font-stat" inputMode="numeric" placeholder="Points" value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, ""))} />
              <input className="input flex-1 min-w-40" placeholder="Reason (required)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn btn-primary" disabled={!addName.trim() || !pts || !note.trim()} onClick={() => void adjust(addName.trim(), 1)}><Plus size={16} /> Add</button>
            </div>
          </div>
        )}

        {!sel && !admin && (
          <div className="text-center py-16 text-muted">
            <Gift size={40} className="mx-auto" />
            <div className="font-black text-xl text-ink mt-2">Pick an employee</div>
            <div className="font-semibold">See their points and history. Use points from the counter cart.</div>
          </div>
        )}

        {sel && hist && (
          <div className="card p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h2 className="text-3xl">{hist.name}</h2>
                <div className="text-muted font-semibold">
                  <span className="font-stat text-ink text-2xl">{hist.balance}</span> points · worth <Money v={value(hist.balance)} />
                </div>
              </div>
              <button className="btn btn-ghost text-sm" onClick={() => setSel(null)}>Close</button>
            </div>
            {admin && (
              <div className="bg-panel-2 rounded-2xl p-3 mt-3">
                <div className="eyebrow mb-1">Add or remove points</div>
                <div className="flex gap-2 flex-wrap">
                  <input className="input w-28 font-stat" inputMode="numeric" placeholder="Points" value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, ""))} />
                  <input className="input flex-1 min-w-40" placeholder="Reason (required)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="btn btn-primary" disabled={!pts || !note.trim()} onClick={() => void adjust(hist.name, 1)}><Plus size={16} /> Add</button>
                  <button className="btn" disabled={!pts || !note.trim()} onClick={() => void adjust(hist.name, -1)}><Minus size={16} /> Remove</button>
                </div>
              </div>
            )}
            <table className="w-full text-sm mt-4">
              <thead className="text-left text-muted">
                <tr><th className="py-1">When</th><th>What</th><th>Details</th><th className="text-right">Points</th></tr>
              </thead>
              <tbody>
                {hist.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td>{KIND[r.kind]}</td>
                    <td className="text-muted">
                      {r.order_number != null && <>Order #{r.order_number} ({r.order_day}){r.order_total != null && <> · <Money v={r.order_total} /></>}</>}
                      {r.note}{r.user_name ? ` · by ${r.user_name}` : ""}
                    </td>
                    <td className={`text-right font-stat ${r.points > 0 ? "text-ink" : "text-danger"}`}>{r.points > 0 ? "+" : ""}{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hist.rows.length === 0 && <div className="text-muted text-sm mt-3">No history yet.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function RewardSettings({ onSaved }: { onSaved: () => void }) {
  const { settings } = useStaff();
  const toast = useToast();
  const [f, setF] = useState({ rewardsEnabled: "1", rewardEarnPerSar: "1", rewardPointsPerSar: "20" });
  useEffect(() => {
    if (settings) setF({ rewardsEnabled: settings.rewardsEnabled, rewardEarnPerSar: settings.rewardEarnPerSar, rewardPointsPerSar: settings.rewardPointsPerSar });
  }, [settings]);
  const earn = Number(f.rewardEarnPerSar) || 0;
  const per = Math.max(1, Math.trunc(Number(f.rewardPointsPerSar) || 1));
  const back = earn > 0 ? Math.round((earn / per) * 1000) / 10 : 0;
  const save = async () => {
    try {
      await api("/api/settings", { method: "PUT", body: f });
      toast("Reward settings saved", "ok");
      onSaved();
    } catch (e) { toast((e as Error).message, "err"); }
  };
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="eyebrow flex-1">Reward settings (admins only)</div>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" className="h-5 w-5 accent-[#FA4B69]" checked={f.rewardsEnabled === "1"}
            onChange={(e) => setF({ ...f, rewardsEnabled: e.target.checked ? "1" : "0" })} /> Rewards on
        </label>
      </div>
      <div className="flex gap-3 flex-wrap items-end mt-2">
        <label className="text-sm font-semibold">Points per SAR paid
          <input className="input w-28 font-stat mt-1" inputMode="decimal" value={f.rewardEarnPerSar} onChange={(e) => setF({ ...f, rewardEarnPerSar: e.target.value })} />
        </label>
        <label className="text-sm font-semibold">Points for SAR 1 off
          <input className="input w-28 font-stat mt-1" inputMode="numeric" value={f.rewardPointsPerSar} onChange={(e) => setF({ ...f, rewardPointsPerSar: e.target.value.replace(/\D/g, "") })} />
        </label>
        <div className="text-sm text-muted font-semibold flex-1 min-w-48 pb-2">
          Employees get back about <b className="text-ink">{back}%</b> of what they spend. A SAR 20 order earns {Math.floor(20 * earn)} points.
        </div>
        <button className="btn btn-dark" onClick={() => void save()}>Save</button>
      </div>
      <p className="text-xs text-muted mt-2">
        Points are earned when an order is paid by cash, card or tab, under the customer name (or the tab name). Free orders earn nothing.
        Cancelling an order takes its points back and returns any points used on it. Changes apply to new orders only.
      </p>
    </div>
  );
}
