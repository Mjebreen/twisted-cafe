// Name field with a real dropdown of employees (the browser's <datalist> shows nothing until you type,
// and on Android only as keyboard suggestions). Opens on tap, filters as you type, still accepts any new name.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export function NameInput({
  value, onChange, names, placeholder, className = "", autoFocus, maxLength = 60, onOpen,
}: {
  value: string;
  onChange: (v: string) => void;
  names: string[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  maxLength?: number;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const q = value.trim().toLowerCase();
    const all = [...new Set(names)].sort((a, b) => a.localeCompare(b));
    if (!q) return all;
    const starts = all.filter((n) => n.toLowerCase().startsWith(q));
    const has = all.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
    return [...starts, ...has];
  }, [names, value]);
  const exact = list.length === 1 && list[0].toLowerCase() === value.trim().toLowerCase();

  useEffect(() => {
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => setHi(-1), [value, open]);

  const show = () => { if (!open) { setOpen(true); onOpen?.(); } };
  const pick = (n: string) => { onChange(n); setOpen(false); };

  return (
    <div ref={box} className="relative">
      <input
        ref={input}
        className={`input pr-16 ${className}`}
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        autoFocus={autoFocus}
        autoComplete="off"
        onFocus={show}
        onClick={show}
        onChange={(e) => { onChange(e.target.value); show(); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); show(); setHi((h) => Math.min(list.length - 1, h + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === "Enter" && open && hi >= 0 && list[hi]) { e.preventDefault(); pick(list[hi]); }
          else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
        }}
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
        {value && (
          <button type="button" className="p-1.5 text-muted hover:text-ink" aria-label="Clear name"
            onClick={() => { onChange(""); input.current?.focus(); setOpen(true); }}>
            <X size={16} />
          </button>
        )}
        <button type="button" className="p-1.5 text-muted hover:text-ink" aria-label="Show employees"
          onClick={() => { if (open) setOpen(false); else { show(); input.current?.focus(); } }}>
          <ChevronDown size={18} className={`transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && !exact && (
        <div className="absolute z-40 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-2xl border-[1.5px] border-border bg-panel shadow-lg py-1">
          {list.map((n, i) => (
            <button
              type="button"
              key={n}
              className={`w-full text-left px-4 py-2.5 font-bold ${i === hi ? "bg-primary/10 text-primary" : "hover:bg-panel-2"}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(n)}
            >
              {n}
            </button>
          ))}
          {list.length === 0 && (
            <div className="px-4 py-2.5 text-sm text-muted font-semibold">
              {names.length === 0 ? "No employees yet. Add them in Team." : `New name: “${value.trim()}”`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
