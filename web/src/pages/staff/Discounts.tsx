// Admin: discount codes.
import { useEffect, useState } from "react";
import { Pencil, Plus, TicketPercent, Trash2, X } from "lucide-react";
import { api, type DiscountCode } from "../../lib/api";
import { BiTitle } from "../../components/Brand";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { fmt } from "../../lib/format";

const SCOPE = { all: "Counter + rooms", counter: "Counter only", room: "Rooms only" } as const;

export default function Discounts() {
  const toast = useToast();
  const [rows, setRows] = useState<DiscountCode[]>([]);
  const [editing, setEditing] = useState<Partial<DiscountCode> | null>(null);
  const load = () => void api<DiscountCode[]>("/api/discounts").then(setRows);
  useEffect(load, []);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); load(); if (ok) toast(ok, "ok"); return true; } catch (e) { toast((e as Error).message, "err"); return false; }
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-end gap-3 flex-wrap">
        <BiTitle en="Discount codes" ar="أكواد الخصم" size="text-4xl" />
        <div className="flex-1" />
        <button className="btn btn-primary" onClick={() => setEditing({ kind: "percent", scope: "all", active: 1, min_order: 0 })}>
          <Plus size={16} /> New code
        </button>
      </div>
      <p className="text-sm text-muted mt-1 font-semibold">Codes work at the counter and in the room order page. The server checks every rule again when the order is placed.</p>

      <div className="grid gap-3 mt-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
        {rows.map((d) => (
          <div key={d.id} className={`card p-4 ${d.active ? "" : "opacity-55"}`}>
            <div className="flex items-start gap-2">
              <span className="h-11 w-11 rounded-2xl bg-primary text-white grid place-items-center shrink-0"><TicketPercent size={22} /></span>
              <div className="flex-1 min-w-0">
                <div className="font-stat text-2xl leading-none tracking-wide truncate">{d.code}</div>
                <div className="font-extrabold text-primary">{d.kind === "percent" ? `${d.value}% off` : <><Money v={d.value} /> off</>}</div>
              </div>
              <button className="btn btn-ghost p-2" onClick={() => setEditing(d)} aria-label="Edit"><Pencil size={16} /></button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="chip bg-panel-3">{SCOPE[d.scope]}</span>
              {d.min_order > 0 && <span className="chip bg-panel-3">Min {fmt(d.min_order)}</span>}
              {d.max_discount != null && <span className="chip bg-panel-3">Max {fmt(d.max_discount)}</span>}
              {d.max_uses != null && <span className="chip bg-panel-3">{d.uses}/{d.max_uses} uses</span>}
              {!!d.once_per_person && <span className="chip bg-panel-3">Once per person</span>}
              {(d.starts_on || d.ends_on) && <span className="chip bg-panel-3">{d.starts_on || "…"} → {d.ends_on || "…"}</span>}
            </div>
            {d.note && <div className="text-sm text-muted mt-2">{d.note}</div>}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border text-sm">
              <span className="font-bold">{d.uses ?? 0} {d.uses === 1 ? "use" : "uses"} · −<Money v={d.given ?? 0} /> given</span>
              <div className="flex-1" />
              <label className="flex items-center gap-2 font-bold cursor-pointer">
                <input type="checkbox" className="h-5 w-5 accent-[#FA4B69]" checked={!!d.active}
                  onChange={(e) => void run(() => api(`/api/discounts/${d.id}`, { method: "PATCH", body: { active: e.target.checked } }))} />
                On
              </label>
            </div>
          </div>
        ))}
      </div>
      {rows.length === 0 && <div className="card p-8 text-center text-muted font-bold mt-4">No discount codes yet.</div>}

      {editing && (
        <Editor
          d={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const ok = await run(() => (editing.id
              ? api(`/api/discounts/${editing.id}`, { method: "PATCH", body })
              : api("/api/discounts", { body })), "Saved");
            if (ok) setEditing(null);
          }}
          onDelete={editing.id ? () => confirm(`Delete ${editing.code}? Past orders keep the code on them.`) &&
            void run(() => api(`/api/discounts/${editing.id}`, { method: "DELETE" }), "Deleted").then((ok) => ok && setEditing(null)) : undefined}
        />
      )}
    </div>
  );
}

function Editor({ d, onClose, onSave, onDelete }: {
  d: Partial<DiscountCode>; onClose: () => void; onSave: (b: unknown) => void; onDelete?: () => void;
}) {
  const sar = (h?: number | null) => (h == null ? "" : String(h / 100));
  const [f, setF] = useState({
    code: d.code || "", kind: d.kind || "percent", value: d.kind === "amount" ? sar(d.value) : String(d.value ?? ""),
    max_discount: sar(d.max_discount), min_order: d.min_order ? sar(d.min_order) : "", scope: d.scope || "all",
    starts_on: d.starts_on || "", ends_on: d.ends_on || "", max_uses: d.max_uses == null ? "" : String(d.max_uses),
    once_per_person: !!d.once_per_person, active: d.active !== 0, note: d.note || "",
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  const num = (v: string) => v.replace(/[^\d.]/g, "");
  const toH = (v: string) => (v === "" ? null : Math.round(Number(v) * 100));
  const save = () => onSave({
    code: f.code, kind: f.kind, value: f.kind === "percent" ? Number(f.value) : toH(f.value),
    max_discount: f.kind === "percent" ? toH(f.max_discount) : null, min_order: toH(f.min_order) ?? 0, scope: f.scope,
    starts_on: f.starts_on || null, ends_on: f.ends_on || null, max_uses: f.max_uses === "" ? null : Number(f.max_uses),
    once_per_person: f.once_per_person, active: f.active, note: f.note,
  });

  return (
    <div className="fixed inset-0 z-50 overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h2 className="text-3xl">{d.id ? "Edit code" : "New code"}</h2>
          <button className="btn btn-ghost p-2" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Field label="Code" wide>
            <input className="input font-stat uppercase tracking-wider text-xl" value={f.code} autoFocus placeholder="e.g. STAFF10"
              onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
          </Field>
          <Field label="Type">
            <div className="grid grid-cols-2 gap-1 bg-panel-3 rounded-full p-1">
              {(["percent", "amount"] as const).map((k) => (
                <button key={k} className={`btn py-1.5 text-sm ${f.kind === k ? "btn-dark" : "btn-ghost"}`} onClick={() => set("kind", k)}>
                  {k === "percent" ? "Percent %" : "Amount SAR"}
                </button>
              ))}
            </div>
          </Field>
          <Field label={f.kind === "percent" ? "Percent off (1-100)" : "SAR off"}>
            <input className="input font-stat" inputMode="decimal" value={f.value} onChange={(e) => set("value", num(e.target.value))} />
          </Field>
          {f.kind === "percent" && (
            <Field label="Max discount, SAR (optional)">
              <input className="input font-stat" inputMode="decimal" value={f.max_discount} onChange={(e) => set("max_discount", num(e.target.value))} />
            </Field>
          )}
          <Field label="Minimum order, SAR (optional)">
            <input className="input font-stat" inputMode="decimal" value={f.min_order} onChange={(e) => set("min_order", num(e.target.value))} />
          </Field>
          <Field label="Where it works" wide>
            <div className="grid grid-cols-3 gap-1 bg-panel-3 rounded-full p-1">
              {(["all", "counter", "room"] as const).map((k) => (
                <button key={k} className={`btn py-1.5 text-sm ${f.scope === k ? "btn-dark" : "btn-ghost"}`} onClick={() => set("scope", k)}>{SCOPE[k]}</button>
              ))}
            </div>
          </Field>
          <Field label="Starts (optional)"><input type="date" className="input" value={f.starts_on} onChange={(e) => set("starts_on", e.target.value)} /></Field>
          <Field label="Ends (optional)"><input type="date" className="input" value={f.ends_on} onChange={(e) => set("ends_on", e.target.value)} /></Field>
          <Field label="Total uses allowed (optional)">
            <input className="input font-stat" inputMode="numeric" placeholder="Unlimited" value={f.max_uses} onChange={(e) => set("max_uses", e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Note (staff only)"><input className="input" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
          <label className="col-span-2 flex items-center gap-2 font-bold">
            <input type="checkbox" className="h-5 w-5 accent-[#FA4B69]" checked={f.once_per_person} onChange={(e) => set("once_per_person", e.target.checked)} />
            Once per person (matched by the name on the order)
          </label>
          <label className="col-span-2 flex items-center gap-2 font-bold">
            <input type="checkbox" className="h-5 w-5 accent-[#FA4B69]" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
            Code is on
          </label>
        </div>
        <div className="flex gap-2 mt-6">
          {onDelete && <button className="btn btn-danger" onClick={onDelete}><Trash2 size={16} /> Delete</button>}
          <div className="flex-1" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={f.code.length < 2 || !f.value} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`block ${wide ? "col-span-2" : ""}`}><span className="eyebrow block mb-1">{label}</span>{children}</label>;
}
