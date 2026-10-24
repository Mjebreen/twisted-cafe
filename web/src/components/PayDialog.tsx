import { useState } from "react";
import { Banknote, CreditCard, Gift, NotebookPen, X } from "lucide-react";
import type { PayMethod } from "../lib/api";
import { Money } from "./Money";
import { fmt } from "../lib/format";

const METHODS: { id: PayMethod; label: string; icon: typeof Banknote }[] = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "card", label: "Card", icon: CreditCard },
  { id: "tab", label: "Tab", icon: NotebookPen },
  { id: "free", label: "Free", icon: Gift },
];

/** Pick how an order is paid. Cash shows change; Tab needs a person's name. */
export function PayDialog({
  total, people, defaultTab = "", preferred, title = "Payment", allowLater = false, busy = false, onPay, onClose,
}: {
  total: number;
  people: string[];
  defaultTab?: string;
  preferred?: string | null;
  title?: string;
  allowLater?: boolean;
  busy?: boolean;
  onPay: (p: { method: PayMethod; tabName?: string } | null) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PayMethod>(
    preferred === "card" || preferred === "tab" ? preferred : "cash",
  );
  const [tab, setTab] = useState(defaultTab);
  const [tendered, setTendered] = useState("");
  const given = Math.round(Number(tendered || 0) * 100);
  const change = given - total;
  const quick = [...new Set([total, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000, 10000])]
    .filter((v) => v >= total).slice(0, 4);

  const ok = method !== "tab" || tab.trim().length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overlay p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-3xl">{title}</h2>
          <button className="btn btn-ghost p-2" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="text-center my-3">
          <Money v={total} className="text-5xl" />
          {preferred && <div className="text-sm text-muted mt-1">Customer asked to pay by <b className="text-ink">{preferred}</b></div>}
        </div>

        <div className="grid grid-cols-4 gap-2">
          {METHODS.map((m) => (
            <button
              key={m.id}
              className={`btn flex-col py-3 ${method === m.id ? "btn-primary" : ""}`}
              onClick={() => setMethod(m.id)}
            >
              <m.icon size={22} />
              <span className="text-sm">{m.label}</span>
            </button>
          ))}
        </div>

        {method === "cash" && (
          <div className="mt-4">
            <div className="flex gap-2 flex-wrap">
              {quick.map((v) => (
                <button key={v} className="btn text-sm" onClick={() => setTendered(String(v / 100))}>{fmt(v)}</button>
              ))}
            </div>
            <input
              className="input mt-2 font-stat"
              inputMode="decimal"
              placeholder="Cash given (optional)"
              value={tendered}
              onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))}
            />
            {given > 0 && (
              <div className={`mt-2 text-lg ${change < 0 ? "text-danger" : "text-ok"}`}>
                {change < 0 ? "Short by " : "Change: "}<Money v={Math.abs(change)} />
              </div>
            )}
          </div>
        )}
        {method === "tab" && (
          <div className="mt-4">
            <input
              className="input"
              list="people-list"
              placeholder="Whose tab?"
              value={tab}
              onChange={(e) => setTab(e.target.value)}
              autoFocus
            />
            <datalist id="people-list">{people.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
        )}
        {method === "free" && <p className="mt-4 text-sm text-muted">Counts as complimentary. Not included in sales.</p>}

        <div className="mt-5 flex gap-2">
          {allowLater && (
            <button className="btn flex-1 py-3" disabled={busy} onClick={() => onPay(null)}>Pay later</button>
          )}
          <button
            className="btn btn-ok flex-[2] py-3 text-lg"
            disabled={!ok || busy}
            onClick={() => onPay({ method, tabName: method === "tab" ? tab.trim() : undefined })}
          >
            {method === "tab" ? "Add to tab" : method === "free" ? "Mark free" : "Paid"}
          </button>
        </div>
      </div>
    </div>
  );
}
