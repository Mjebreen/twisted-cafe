// Top-bar printer button: connect a Bluetooth receipt printer on this device, test it, see its status.
import { useEffect, useRef, useState } from "react";
import { Bluetooth, Cable, Printer, Unplug } from "lucide-react";
import {
  bleSupported, connectBle, connectSerial, disconnect, isSlow, printTest, reconnect, serialSupported, setSlow, usePrinter,
} from "../lib/printer";
import { useToast } from "./Toast";

export function PrinterButton({ paper }: { paper: 58 | 80 }) {
  const p = usePrinter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const run = (f: () => Promise<unknown>, ok?: string) => () => {
    f().then(() => ok && toast(ok, "ok")).catch((e) => {
      const m = (e as Error).message || String(e);
      if (!/cancel/i.test(m)) toast(m, "err"); // picker closed without choosing
    });
  };
  const dot = p.status === "ready" ? "bg-green-400" : p.status === "printing" || p.status === "connecting" ? "bg-yellow" : p.status === "error" ? "bg-primary" : "bg-white/30";
  const secure = window.isSecureContext;

  return (
    <div ref={box} className="relative">
      <button
        className="relative btn btn-ghost p-2 text-white hover:bg-white/10"
        aria-label="Receipt printer"
        title={p.kind ? `${p.name}: ${p.status}` : "Connect a receipt printer"}
        onClick={() => setOpen((v) => !v)}
      >
        <Printer size={18} />
        {p.kind && <span className={`absolute top-1 right-1 h-2.5 w-2.5 rounded-full ${dot}`} />}
      </button>
      {open && (
        <div className="fixed right-3 top-14 w-80 max-w-[calc(100vw-24px)] z-50 card p-4 text-ink shadow-xl space-y-3">
          <div>
            <div className="eyebrow">Receipt printer (this device)</div>
            {p.kind ? (
              <div className="font-extrabold">{p.name} · <span className="text-muted font-semibold">{p.status}</span></div>
            ) : (
              <div className="text-sm text-muted font-semibold">None. Receipts open the print dialog.</div>
            )}
            {p.error && <div className="text-sm text-danger font-semibold mt-1">{p.error}</div>}
          </div>

          {!secure && (
            <div className="text-sm bg-yellow/30 rounded-xl p-3 font-semibold">
              Bluetooth only works on a secure page. Open the app over <b>https://</b>, or in Chrome on this tablet open
              <code className="block my-1 text-xs break-all">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>
              add <code className="text-xs break-all">{location.origin}</code>, set it to Enabled, and relaunch Chrome.
            </div>
          )}

          {secure && !p.kind && (
            <div className="space-y-2">
              {bleSupported() && (
                <button className="btn btn-primary w-full" onClick={run(connectBle, "Printer connected")}>
                  <Bluetooth size={16} /> Connect Bluetooth printer
                </button>
              )}
              {serialSupported() && (
                <button className="btn w-full" onClick={run(connectSerial, "Printer connected")}>
                  <Cable size={16} /> Bluetooth serial (PC, older printers)
                </button>
              )}
              {!bleSupported() && !serialSupported() && (
                <div className="text-sm text-muted">This browser can't reach Bluetooth printers. Use Chrome.</div>
              )}
              <p className="text-xs text-muted">
                Turn the printer on first. In the list, pick it by name (e.g. <b>PT-210_20E7</b>). No need to pair it in Android settings.
              </p>
            </div>
          )}

          {p.kind && (
            <div className="space-y-2">
              {p.status !== "ready" && p.status !== "printing" && (
                <button className="btn btn-primary w-full" onClick={run(() => reconnect(), "Printer connected")}>
                  <Bluetooth size={16} /> Reconnect
                </button>
              )}
              <button className="btn w-full" disabled={p.status === "printing"} onClick={run(() => printTest(paper))}>
                <Printer size={16} /> Test print ({paper}mm)
              </button>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={isSlow()} onChange={(e) => setSlow(e.target.checked)} />
                Slow mode (if prints come out cut or garbled)
              </label>
              <button className="btn btn-ghost w-full text-danger" onClick={run(disconnect)}>
                <Unplug size={16} /> Forget this printer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
