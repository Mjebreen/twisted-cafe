import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import type { Item } from "../lib/api";
import { Money } from "./Money";

type Pick = { g: number; c: number };

/** Modal to choose options / qty / note for one item. Used by counter and room ordering. */
export function ItemPicker({
  item, ar = false, onAdd, onClose,
}: {
  item: Item;
  ar?: boolean;
  onAdd: (picks: Pick[], qty: number, note: string) => void;
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<Pick[]>(() =>
    item.options.flatMap((g, gi) => (g.required && g.type === "single" ? [{ g: gi, c: 0 }] : [])),
  );
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const toggle = (g: number, c: number, multi: boolean) => {
    setPicks((p) => {
      const has = p.some((x) => x.g === g && x.c === c);
      if (multi) return has ? p.filter((x) => !(x.g === g && x.c === c)) : [...p, { g, c }];
      const rest = p.filter((x) => x.g !== g);
      const required = item.options[g].required;
      return has && !required ? rest : [...rest, { g, c }];
    });
  };
  const missing = item.options.some((g, gi) => g.required && !picks.some((p) => p.g === gi));
  const unit = item.price + picks.reduce((s, p) => s + (item.options[p.g]?.choices[p.c]?.price || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center overlay" onClick={onClose}>
      <div
        className="card w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-b-none sm:rounded-b-[0.9rem] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-3xl">{ar && item.name_ar ? item.name_ar : item.name}</h2>
            {item.description && <p className="text-sm text-muted mt-1">{item.description}</p>}
          </div>
          <button className="btn btn-ghost p-2" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        {item.options.map((g, gi) => (
          <div key={gi} className="mt-4">
            <div className="text-sm font-semibold mb-2">
              {ar && g.name_ar ? g.name_ar : g.name}
              <span className="text-muted font-normal">
                {g.required ? (ar ? " · مطلوب" : " · required") : g.type === "multi" ? (ar ? " · اختر أي عدد" : " · pick any") : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {g.choices.map((c, ci) => {
                const on = picks.some((p) => p.g === gi && p.c === ci);
                return (
                  <button
                    key={ci}
                    className={`btn text-sm ${on ? "btn-primary" : ""}`}
                    onClick={() => toggle(gi, ci, g.type === "multi")}
                  >
                    {c.name}
                    {c.price > 0 && <span className="opacity-80">+<Money v={c.price} /></span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <input
          className="input mt-4"
          placeholder={ar ? "ملاحظة (اختياري)" : "Note (optional), e.g. extra hot"}
          value={note}
          maxLength={120}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="mt-5 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button className="btn p-3" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less"><Minus size={18} /></button>
            <span className="font-stat text-xl w-8 text-center">{qty}</span>
            <button className="btn p-3" onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label="More"><Plus size={18} /></button>
          </div>
          <button className="btn btn-primary flex-1 py-3 text-lg" disabled={missing} onClick={() => onAdd(picks, qty, note.trim())}>
            {ar ? "أضف" : "Add"} · <Money v={unit * qty} />
          </button>
        </div>
      </div>
    </div>
  );
}
