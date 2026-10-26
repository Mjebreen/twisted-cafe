// Admin: staff logins (PINs) and the employee list used for names / tabs.
import { useEffect, useState } from "react";
import { Combine, Plus } from "lucide-react";
import { MergeNames } from "./MergeNames";
import { api } from "../../lib/api";
import { useStaff } from "./StaffContext";
import { useToast } from "../../components/Toast";

type U = { id: number; name: string; role: "admin" | "staff"; active: number };
type P = { id: number; name: string; active: number };

export default function Team() {
  const { reloadPeople } = useStaff();
  const toast = useToast();
  const [users, setUsers] = useState<U[]>([]);
  const [people, setPeople] = useState<P[]>([]);
  const [nu, setNu] = useState({ name: "", pin: "", role: "staff" });
  const [np, setNp] = useState("");
  const [merging, setMerging] = useState(false);
  const [dupes, setDupes] = useState(0);
  const load = () => {
    void api<U[]>("/api/users").then(setUsers);
    void api<P[]>("/api/people").then(setPeople);
    reloadPeople();
    void api<unknown[]>("/api/people/duplicates").then((g) => setDupes(g.length)).catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); load(); if (ok) toast(ok, "ok"); } catch (e) { toast((e as Error).message, "err"); }
  };

  return (
    <div className="h-full overflow-y-auto p-4 grid lg:grid-cols-2 gap-6 content-start">
      <section>
        <h1 className="text-4xl">Staff logins</h1>
        <p className="text-sm text-muted">Each person signs in on the tablet with their own PIN. Admins can edit menu, rooms, team, and settings.</p>
        <div className="card p-3 mt-3 flex gap-2 flex-wrap">
          <input className="input flex-1 min-w-32" placeholder="Name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
          <input className="input w-28 font-stat" placeholder="PIN" inputMode="numeric" maxLength={8} value={nu.pin} onChange={(e) => setNu({ ...nu, pin: e.target.value.replace(/\D/g, "") })} />
          <select className="input w-28" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
            <option value="staff">Staff</option><option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary" disabled={!nu.name || nu.pin.length < 4}
            onClick={() => void run(() => api("/api/users", { body: nu }).then(() => setNu({ name: "", pin: "", role: "staff" })), "User added")}>
            <Plus size={16} /> Add
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {users.map((u) => (
            <div key={u.id} className={`card px-4 py-3 flex items-center gap-2 ${u.active ? "" : "opacity-50"}`}>
              <div className="flex-1 font-semibold">{u.name} <span className="text-xs text-muted uppercase">{u.role}</span></div>
              <button className="btn text-sm" onClick={() => {
                const pin = prompt(`New PIN for ${u.name} (4-8 digits)`);
                if (pin) void run(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { pin } }), "PIN changed");
              }}>Change PIN</button>
              <button className="btn text-sm" onClick={() => void run(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { role: u.role === "admin" ? "staff" : "admin" } }))}>
                Make {u.role === "admin" ? "staff" : "admin"}
              </button>
              <button className="btn text-sm" onClick={() => void run(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { active: !u.active } }))}>
                {u.active ? "Disable" : "Enable"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-4xl">Employees</h1>
          <div className="flex-1" />
          <button className="btn btn-dark" onClick={() => setMerging(true)}>
            <Combine size={16} /> Merge names
            {dupes > 0 && <span className="chip bg-primary text-white">{dupes} to check</span>}
          </button>
        </div>
        <p className="text-sm text-muted">Names suggested when ordering from rooms and when charging a tab. New names from room orders are added automatically.</p>
        <div className="card p-3 mt-3 flex gap-2">
          <input className="input flex-1" placeholder="Employee name" value={np} onChange={(e) => setNp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && np.trim() && void run(() => api("/api/people", { body: { name: np } }).then(() => setNp("")))} />
          <button className="btn btn-primary" disabled={!np.trim()} onClick={() => void run(() => api("/api/people", { body: { name: np } }).then(() => setNp("")))}>
            <Plus size={16} /> Add
          </button>
        </div>
        <div className="mt-3 grid sm:grid-cols-2 gap-2">
          {people.map((p) => (
            <div key={p.id} className={`card px-3 py-2 flex items-center gap-2 ${p.active ? "" : "opacity-50"}`}>
              <span className="flex-1 truncate">{p.name}</span>
              <button className="btn btn-ghost text-xs py-1" onClick={() => {
                const name = prompt("Rename", p.name);
                if (name) void run(() => api(`/api/people/${p.id}`, { method: "PATCH", body: { name } }));
              }}>Rename</button>
              <button className="btn btn-ghost text-xs py-1" onClick={() => void run(() => api(`/api/people/${p.id}`, { method: "PATCH", body: { active: !p.active } }))}>
                {p.active ? "Hide" : "Show"}
              </button>
            </div>
          ))}
        </div>
      </section>
      {merging && <MergeNames onClose={() => { setMerging(false); load(); }} onChanged={load} />}
    </div>
  );
}
