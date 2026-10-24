// Admin: categories, items, option groups, CSV import.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { api, ApiError, type Category, type Item, type OptionGroup } from "../../lib/api";
import { useStaff } from "./StaffContext";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";

export default function MenuAdmin() {
  const { menu, reloadMenu } = useStaff();
  const toast = useToast();
  const [catId, setCatId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const cats = menu?.categories || [];
  useEffect(() => { if (catId == null && cats[0]) setCatId(cats[0].id); }, [cats, catId]);
  const items = (menu?.items || []).filter((i) => i.category_id === catId);
  const cat = cats.find((c) => c.id === catId);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); reloadMenu(); if (ok) toast(ok, "ok"); } catch (e) { toast((e as Error).message, "err"); }
  };
  const deleteCat = async (c: Category) => {
    if (!confirm(`Delete the category "${c.name}"?`)) return;
    try {
      await api(`/api/categories/${c.id}`, { method: "DELETE" });
    } catch (e) {
      // Still has items: ask once more, then delete the category together with its items.
      if (!(e instanceof ApiError && e.status === 409)) return toast((e as Error).message, "err");
      if (!confirm(`${e.message}. Delete those items too? Past sales keep their history.`)) return;
      try { await api(`/api/categories/${c.id}?withItems=1`, { method: "DELETE" }); }
      catch (e2) { return toast((e2 as Error).message, "err"); }
    }
    setCatId(null);
    reloadMenu();
    toast(`Deleted "${c.name}"`, "ok");
  };
  const addCat = () => {
    const name = prompt("Category name (English)");
    if (name) void run(() => api("/api/categories", { body: { name, name_ar: prompt("Arabic name (optional)") || "" } }));
  };
  const editCat = (c: Category) => {
    const name = prompt("Category name", c.name);
    if (name === null) return;
    const name_ar = prompt("Arabic name", c.name_ar);
    void run(() => api(`/api/categories/${c.id}`, { method: "PATCH", body: { name, name_ar: name_ar ?? c.name_ar } }));
  };
  const moveCat = (c: Category, d: number) => {
    const list = [...cats];
    const i = list.findIndex((x) => x.id === c.id);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void run(() => Promise.all(list.map((x, k) => api(`/api/categories/${x.id}`, { method: "PATCH", body: { sort: k } }))));
  };
  const moveItem = (it: Item, d: number) => {
    const list = [...items];
    const i = list.findIndex((x) => x.id === it.id);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void run(() => Promise.all(list.map((x, k) => api(`/api/items/${x.id}`, { method: "PATCH", body: { sort: k } }))));
  };
  const importCsv = async (f: File) => {
    const text = await f.text();
    void run(async () => {
      const r = await api<{ added: number; updated: number }>("/api/menu/import", { raw: text });
      toast(`Imported: ${r.added} added, ${r.updated} updated`, "ok");
    });
  };

  return (
    <div className="h-full flex">
      <div className="w-64 border-r border-border flex flex-col">
        <div className="p-3 flex gap-2 border-b border-border">
          <button className="btn btn-primary flex-1 text-sm" onClick={addCat}><Plus size={16} /> Category</button>
          <label className="btn text-sm cursor-pointer" title="Import CSV (Name, Category, Price). Loyverse item export works.">
            <Upload size={16} />
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])} />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto">
          {cats.map((c) => (
            <div key={c.id} className={`flex items-center gap-1 px-2 border-b border-border ${c.id === catId ? "bg-panel-3" : ""}`}>
              <button className={`flex-1 text-left py-3 px-1 ${c.active ? "" : "line-through text-muted"}`} onClick={() => setCatId(c.id)}>
                {c.name}<div className="text-xs text-muted">{c.name_ar}</div>
              </button>
              <button className="p-1 text-muted" onClick={() => moveCat(c, -1)}><ArrowUp size={14} /></button>
              <button className="p-1 text-muted" onClick={() => moveCat(c, 1)}><ArrowDown size={14} /></button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {cat && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-4xl">{cat.name}</h1>
              <button className="btn btn-ghost p-2" onClick={() => editCat(cat)}><Pencil size={16} /></button>
              <button className="btn btn-ghost text-sm" onClick={() => void run(() => api(`/api/categories/${cat.id}`, { method: "PATCH", body: { active: !cat.active } }))}>
                {cat.active ? "Hide category" : "Show category"}
              </button>
              <button className="btn btn-danger text-sm" onClick={() => void deleteCat(cat)}>
                <Trash2 size={16} /> Delete category
              </button>
              <div className="flex-1" />
              <button className="btn btn-primary" onClick={() => setEditing({ category_id: cat.id, price: 0, options: [], available: 1, room_orderable: 1, name: "", name_ar: "", description: "" })}>
                <Plus size={16} /> Item
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {items.map((i) => (
                <div key={i.id} className="card px-4 py-3 flex items-center gap-3">
                  <div className="flex flex-col">
                    <button className="text-muted" onClick={() => moveItem(i, -1)}><ArrowUp size={14} /></button>
                    <button className="text-muted" onClick={() => moveItem(i, 1)}><ArrowDown size={14} /></button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{i.name} <span className="text-muted font-normal">{i.name_ar}</span></div>
                    <div className="text-xs text-muted">
                      {i.options.map((g) => g.name).join(" · ") || "No options"}
                      {!i.room_orderable && " · counter only"}
                    </div>
                  </div>
                  <button
                    className={`btn text-xs py-1 ${i.available ? "btn-ghost text-ok" : "btn-danger"}`}
                    onClick={() => void run(() => api(`/api/items/${i.id}/availability`, { method: "PATCH", body: { available: !i.available } }))}
                  >
                    {i.available ? "In stock" : "Sold out"}
                  </button>
                  <Money v={i.price} className="w-20 justify-end" />
                  <button className="btn btn-ghost p-2" onClick={() => setEditing(i)}><Pencil size={16} /></button>
                </div>
              ))}
              {items.length === 0 && <div className="text-muted">No items yet.</div>}
            </div>
          </>
        )}
      </div>
      {editing && (
        <ItemEditor
          item={editing}
          cats={cats}
          onClose={() => setEditing(null)}
          onSave={(body) => void run(async () => {
            if (editing.id) await api(`/api/items/${editing.id}`, { method: "PATCH", body });
            else await api("/api/items", { body });
            setEditing(null);
          }, "Saved")}
          onDelete={editing.id ? () => confirm("Delete this item? Past sales keep their history.") &&
            void run(async () => { await api(`/api/items/${editing.id}`, { method: "DELETE" }); setEditing(null); }) : undefined}
        />
      )}
    </div>
  );
}

function ItemEditor({ item, cats, onClose, onSave, onDelete }: {
  item: Partial<Item>; cats: Category[]; onClose: () => void; onSave: (b: unknown) => void; onDelete?: () => void;
}) {
  const [f, setF] = useState({
    name: item.name || "", name_ar: item.name_ar || "", description: item.description || "",
    price: String((item.price || 0) / 100), category_id: item.category_id, available: !!item.available,
    room_orderable: item.room_orderable !== 0,
  });
  const [groups, setGroups] = useState<(OptionGroup & { choices: { name: string; price: number | string }[] })[]>(
    () => (item.options || []).map((g) => ({ ...g, choices: g.choices.map((c) => ({ name: c.name, price: c.price / 100 })) })),
  );
  const setG = (i: number, patch: Partial<OptionGroup>) => setGroups((gs) => gs.map((g, k) => (k === i ? { ...g, ...patch } : g)));

  const save = () => onSave({
    ...f,
    price: Math.round(Number(f.price || 0) * 100),
    options: groups.map((g) => ({ ...g, choices: g.choices.map((c) => ({ name: c.name, price: Math.round(Number(c.price || 0) * 100) })) })),
  });

  return (
    <div className="fixed inset-0 z-50 overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h2 className="text-3xl">{item.id ? "Edit item" : "New item"}</h2>
          <button className="btn btn-ghost p-2" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Arabic name"><input className="input" dir="rtl" value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} /></Field>
          <Field label="Price (SAR)"><input className="input font-stat" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
          <Field label="Category">
            <select className="input" value={f.category_id} onChange={(e) => setF({ ...f, category_id: Number(e.target.value) })}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div className="col-span-2"><Field label="Description (shown on room menu)"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} /> In stock</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.room_orderable} onChange={(e) => setF({ ...f, room_orderable: e.target.checked })} /> Can be ordered from rooms</label>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <h3 className="text-2xl">Options</h3>
          <button className="btn text-sm" onClick={() => setGroups([...groups, { name: "", type: "single", required: false, choices: [{ name: "", price: 0 }] }])}>
            <Plus size={14} /> Option group
          </button>
        </div>
        <p className="text-xs text-muted">e.g. Size (required, pick one), Milk (pick one), Extras (pick any). Price is the extra charge.</p>
        {groups.map((g, gi) => (
          <div key={gi} className="border border-border rounded-lg p-3 mt-3">
            <div className="flex gap-2 items-center flex-wrap">
              <input className="input flex-1 min-w-32" placeholder="Group name, e.g. Milk" value={g.name} onChange={(e) => setG(gi, { name: e.target.value })} />
              <input className="input w-32" dir="rtl" placeholder="عربي" value={g.name_ar || ""} onChange={(e) => setG(gi, { name_ar: e.target.value })} />
              <select className="input w-32" value={g.type} onChange={(e) => setG(gi, { type: e.target.value as "single" | "multi" })}>
                <option value="single">Pick one</option><option value="multi">Pick any</option>
              </select>
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={g.required} onChange={(e) => setG(gi, { required: e.target.checked })} /> Required</label>
              <button className="btn btn-ghost p-2 text-danger" onClick={() => setGroups(groups.filter((_, k) => k !== gi))}><Trash2 size={16} /></button>
            </div>
            {g.choices.map((c, ci) => (
              <div key={ci} className="flex gap-2 mt-2">
                <input className="input flex-1" placeholder="Choice, e.g. Oat" value={c.name}
                  onChange={(e) => setG(gi, { choices: g.choices.map((x, k) => (k === ci ? { ...x, name: e.target.value } : x)) as OptionGroup["choices"] })} />
                <input className="input w-28 font-stat" placeholder="+0" inputMode="decimal" value={c.price}
                  onChange={(e) => setG(gi, { choices: g.choices.map((x, k) => (k === ci ? { ...x, price: e.target.value.replace(/[^\d.]/g, "") } : x)) as OptionGroup["choices"] })} />
                <button className="btn btn-ghost p-2" onClick={() => setG(gi, { choices: g.choices.filter((_, k) => k !== ci) as OptionGroup["choices"] })}><X size={16} /></button>
              </div>
            ))}
            <button className="btn btn-ghost text-sm mt-2" onClick={() => setG(gi, { choices: [...g.choices, { name: "", price: 0 }] as OptionGroup["choices"] })}>
              <Plus size={14} /> Choice
            </button>
          </div>
        ))}

        <div className="flex gap-2 mt-6">
          {onDelete && <button className="btn btn-danger" onClick={onDelete}><Trash2 size={16} /> Delete</button>}
          <div className="flex-1" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!f.name.trim()} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs text-muted block mb-1">{label}</span>{children}</label>;
}
