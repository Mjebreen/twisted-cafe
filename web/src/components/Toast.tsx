import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type T = { id: number; text: string; kind: "ok" | "err" | "info"; action?: { label: string; run: () => void } };
const Ctx = createContext<(text: string, kind?: T["kind"], action?: T["action"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<T[]>([]);
  const push = useCallback((text: string, kind: T["kind"] = "info", action?: T["action"]) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-3), { id, text, kind, action }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), action ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="no-print fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[min(92vw,420px)]">
        {list.map((t) => (
          <div
            key={t.id}
            className={`pop-in bg-ink text-white font-bold rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl border-l-[6px] ${
              t.kind === "ok" ? "border-l-cyan" : t.kind === "err" ? "border-l-red" : "border-l-primary"
            }`}
          >
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button className="btn btn-primary text-sm py-1" onClick={t.action.run}>{t.action.label}</button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
