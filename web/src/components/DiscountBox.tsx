// Discount code entry used by the counter cart and the room cart.
import { useState } from "react";
import { TicketPercent, X } from "lucide-react";
import type { DiscountPreview } from "../lib/api";
import { Money } from "./Money";

export function DiscountBox({
  applied, onApply, onRemove, ar = false, compact = false,
}: {
  applied: DiscountPreview | null;
  onApply: (code: string) => Promise<void>;
  onRemove: () => void;
  ar?: boolean;
  compact?: boolean;
}) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  if (applied) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-cyan/25 border border-cyan px-3 py-2">
        <TicketPercent size={18} className="shrink-0" />
        <span className="font-extrabold">{applied.code}</span>
        <span className="text-sm font-semibold text-muted">{applied.label}</span>
        <span className="flex-1" />
        <span className="font-stat">−<Money v={applied.amount} /></span>
        <button className="btn btn-ghost p-1.5" onClick={onRemove} aria-label={ar ? "إزالة الخصم" : "Remove discount"}><X size={16} /></button>
      </div>
    );
  }
  if (compact && !open) {
    return (
      <button className="text-sm font-extrabold text-primary flex items-center gap-1.5" onClick={() => setOpen(true)}>
        <TicketPercent size={16} /> {ar ? "عندك كود خصم؟" : "Have a discount code?"}
      </button>
    );
  }
  const apply = async () => {
    setBusy(true); setErr("");
    try {
      await onApply(code.trim());
      setCode("");
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void apply(); }}>
        <input
          className="input py-2 uppercase font-extrabold tracking-wide"
          placeholder={ar ? "كود الخصم" : "Discount code"}
          value={code}
          maxLength={40}
          autoFocus={compact}
          onChange={(e) => { setCode(e.target.value); setErr(""); }}
        />
        <button className="btn btn-dark shrink-0" disabled={!code.trim() || busy}>{ar ? "تطبيق" : "Apply"}</button>
      </form>
      {err && <p className="text-danger text-sm font-bold mt-1">{err}</p>}
    </div>
  );
}
