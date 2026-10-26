// Admin: weekly clean-up of employee names. Suggested duplicates + manual merge.
import { useEffect, useMemo, useState } from "react";
import { Check, Combine, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { timeAgo } from "../../lib/format";

type Name = { name: string; person_id: number | null; active: number | null; orders: number; tab_entries: number; last_seen: string | null };
type Group = { names: Name[]; suggested: string; reasons: string[] };
type MergeResult = { into: string; from: string[]; orders: number; tabOrders: number; tabPayments: number };

const REASON: Record<string, string> = {
  "same letters": "same letters", spacing: "extra spaces", spelling: "small spelling difference", "short form": "short form of the name",
};

function usage(n: Name) {
  const parts = [];
  if (n.orders) parts.push(`${n.orders} order${n.orders === 1 ? "" : "s"}`);
  if (n.tab_entries) parts.push(`${n.tab_entries} tab`);
  if (!parts.length) parts.push(n.person_id ? "on the list, never ordered" : "unused");
  if (n.last_seen) parts.push(`last ${timeAgo(n.last_seen)} ago`);
  return parts.join(" · ");
}

export function MergeNames({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<"suggested" | "manual">("suggested");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [names, setNames] = useState<Name[]>([]);
  const load = () => {
    void api<Group[]>("/api/people/duplicates").then(setGroups);
    void api<Name[]>("/api/people/names").then(setNames);
  };
  useEffect(load, []);

  const merge = async (into: string, from: string[]) => {
    const list = from.filter((f) => f !== into);
    if (!list.length) return toast("Pick at least one name to merge", "err");
    if (!confirm(`Merge ${list.map((n) => `"${n}"`).join(", ")} into "${into}"?\n\nPast orders, tab charges and tab payments move to "${into}". This can't be undone.`)) return;
    try {
      const r = await api<MergeResult>("/api/people/merge", { body: { into, from: list } });
      toast(`Merged into ${r.into}: ${r.orders} orders, ${r.tabOrders + r.tabPayments} tab entries moved`, "ok");
      load(); onChanged();
    } catch (e) { toast((e as Error).message, "err"); }
  };
  const ignore = async (g: Group) => {
    try {
      await api("/api/people/ignore", { body: { names: g.names.map((n) => n.name) } });
      toast("Got it. These won't be suggested again.", "ok");
      load();
    } catch (e) { toast((e as Error).message, "err"); }
  };

  return (
    <div className="fixed inset-0 z-50 overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-3xl h-[88vh] flex flex-col pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 pb-3 flex items-start gap-3">
          <div className="flex-1">
            <div className="ar text-primary font-extrabold">دمج الأسماء</div>
            <h2 className="text-3xl">Merge employee names</h2>
            <p className="text-sm text-muted font-semibold mt-1">When someone types their name differently, merge the versions so their orders and tab end up under one name.</p>
          </div>
          <button className="btn btn-ghost p-2" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="px-5 flex gap-2">
          <button className={`btn text-sm ${tab === "suggested" ? "btn-dark" : "bg-panel-3"}`} onClick={() => setTab("suggested")}>
            Possible duplicates {groups && <span className={`chip ${groups.length ? "bg-primary text-white" : "bg-panel text-ink"}`}>{groups.length}</span>}
          </button>
          <button className={`btn text-sm ${tab === "manual" ? "btn-dark" : "bg-panel-3"}`} onClick={() => setTab("manual")}>Pick names myself</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 pt-4">
          {tab === "suggested"
            ? <Suggested groups={groups} onMerge={merge} onIgnore={ignore} />
            : <Manual names={names} onMerge={merge} />}
        </div>
      </div>
    </div>
  );
}

function Suggested({ groups, onMerge, onIgnore }: {
  groups: Group[] | null; onMerge: (into: string, from: string[]) => void; onIgnore: (g: Group) => void;
}) {
  if (!groups) return <div className="text-muted">Looking…</div>;
  if (!groups.length) {
    return (
      <div className="text-center py-12">
        <div className="mx-auto h-16 w-16 rounded-full bg-cyan grid place-items-center"><Check size={30} /></div>
        <div className="font-black text-2xl mt-3">All clean</div>
        <div className="text-muted font-semibold">No names look alike right now. Check again next week.</div>
      </div>
    );
  }
  return <div className="space-y-3">{groups.map((g) => <GroupCard key={g.names.map((n) => n.name).join("|")} g={g} onMerge={onMerge} onIgnore={onIgnore} />)}</div>;
}

function GroupCard({ g, onMerge, onIgnore }: { g: Group; onMerge: (into: string, from: string[]) => void; onIgnore: (g: Group) => void }) {
  const [keep, setKeep] = useState(g.suggested);
  const [use, setUse] = useState<Set<string>>(() => new Set(g.names.map((n) => n.name)));
  const toggle = (n: string) => setUse((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const chosen = g.names.filter((n) => use.has(n.name) && n.name !== keep).map((n) => n.name);
  return (
    <div className="border-[1.5px] border-border rounded-2xl p-4">
      <div className="text-xs font-bold text-muted mb-2">Looks alike: {g.reasons.map((r) => REASON[r] || r).join(", ")}</div>
      <div className="space-y-1.5">
        {g.names.map((n) => (
          <div key={n.name} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${keep === n.name ? "bg-primary/10" : ""}`}>
            <input type="checkbox" className="h-5 w-5 accent-[#FA4B69]" checked={use.has(n.name) || keep === n.name} disabled={keep === n.name} onChange={() => toggle(n.name)} aria-label={`Include ${n.name}`} />
            <div className="flex-1 min-w-0">
              <div className="font-extrabold truncate whitespace-pre">{n.name}</div>
              <div className="text-xs text-muted font-semibold">{usage(n)}</div>
            </div>
            <label className={`chip cursor-pointer ${keep === n.name ? "bg-primary text-white" : "bg-panel-3"}`}>
              <input type="radio" className="hidden" checked={keep === n.name} onChange={() => { setKeep(n.name); setUse((s) => new Set(s).add(n.name)); }} />
              {keep === n.name ? "Keep this" : "Keep this?"}
            </label>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn btn-primary text-sm" disabled={!chosen.length} onClick={() => onMerge(keep, chosen)}>
          <Combine size={16} /> Merge {chosen.length} into “{keep}”
        </button>
        <button className="btn btn-ghost text-sm" onClick={() => onIgnore(g)}>Not the same person</button>
      </div>
    </div>
  );
}

function Manual({ names, onMerge }: { names: Name[]; onMerge: (into: string, from: string[]) => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [keep, setKeep] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return names.filter((n) => !s || n.name.toLowerCase().includes(s));
  }, [names, q]);
  const toggle = (n: string) => {
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
    if (!keep) setKeep(n);
  };
  useEffect(() => { if (keep && !picked.includes(keep) && names.some((n) => n.name === keep)) setKeep(picked[0] || ""); }, [picked]); // eslint-disable-line

  return (
    <div className="grid md:grid-cols-[1fr_280px] gap-4 h-full">
      <div className="min-h-0 flex flex-col">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9 py-2" placeholder="Search names" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="mt-2 space-y-1 overflow-y-auto">
          {shown.map((n) => (
            <button key={n.name} onClick={() => toggle(n.name)}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left border-[1.5px] ${picked.includes(n.name) ? "border-primary bg-primary/5" : "border-transparent hover:bg-panel-3"}`}>
              <span className={`h-5 w-5 rounded-md grid place-items-center ${picked.includes(n.name) ? "bg-primary text-white" : "bg-panel-3"}`}>
                {picked.includes(n.name) && <Check size={14} strokeWidth={3} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="font-extrabold block truncate whitespace-pre">{n.name}</span>
                <span className="text-xs text-muted font-semibold">{usage(n)}</span>
              </span>
            </button>
          ))}
          {shown.length === 0 && <div className="text-muted p-4">No names match.</div>}
        </div>
      </div>
      <div className="bg-panel-2 rounded-2xl p-4 self-start">
        <div className="eyebrow">Selected</div>
        {picked.length === 0 && <p className="text-sm text-muted font-semibold mt-1">Tap the names that are the same person.</p>}
        <div className="space-y-1 mt-2">
          {picked.map((n) => (
            <label key={n} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 cursor-pointer ${keep === n ? "bg-primary/10" : ""}`}>
              <input type="radio" className="accent-[#FA4B69]" checked={keep === n} onChange={() => setKeep(n)} />
              <span className="font-bold truncate whitespace-pre">{n}</span>
            </label>
          ))}
        </div>
        {picked.length > 0 && (
          <>
            <div className="eyebrow mt-4 mb-1">Keep as (you can fix the spelling)</div>
            <input className="input py-2" value={keep} onChange={(e) => setKeep(e.target.value)} />
            <button className="btn btn-primary w-full mt-3" disabled={keep.trim().length < 2 || picked.filter((p) => p !== keep.trim()).length === 0}
              onClick={() => onMerge(keep.trim(), picked)}>
              <Combine size={16} /> Merge {picked.length} into one
            </button>
          </>
        )}
      </div>
    </div>
  );
}
