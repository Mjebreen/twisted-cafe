// Admin: cafe settings + backup.
import { useEffect, useState } from "react";
import { Download, Upload } from "lucide-react";
import { api, type Settings } from "../../lib/api";
import { useStaff } from "./StaffContext";
import { useToast } from "../../components/Toast";

export default function SettingsPage() {
  const { settings, reloadSettings } = useStaff();
  const toast = useToast();
  const [f, setF] = useState<Settings | null>(settings);
  useEffect(() => setF(settings), [settings]);
  const [withOrders, setWithOrders] = useState(true);
  const { reloadMenu, reloadRooms } = useStaff();
  const importPos2 = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const r = await api<{ items: number; rooms: number; orders: number; ordersSkipped: number; itemsRemoved: number }>(
        `/api/import/pos2?orders=${withOrders ? 1 : 0}`, { body: data });
      reloadMenu(); reloadRooms(); reloadSettings();
      toast(`Imported ${r.items} items, ${r.rooms} new rooms, ${r.orders} orders${r.ordersSkipped ? ` (${r.ordersSkipped} already there)` : ""}`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  if (!f) return null;
  const set = (k: keyof Settings, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    try { await api("/api/settings", { method: "PUT", body: f }); reloadSettings(); toast("Settings saved", "ok"); }
    catch (e) { toast((e as Error).message, "err"); }
  };

  return (
    <div className="h-full overflow-y-auto p-4 max-w-2xl">
      <h1 className="text-4xl">Settings</h1>
      <div className="space-y-4 mt-4">
        <Row label="Cafe name (receipts, room menu)"><input className="input" value={f.cafeName} onChange={(e) => set("cafeName", e.target.value)} /></Row>
        <Row label="Arabic name (as on the VAT certificate)" hint="Printed on receipts and used as the seller name in the receipt QR code. Saudi tax invoices must be in Arabic.">
          <input className="input ar" dir="rtl" placeholder="مقهى تويستد مايندز" value={f.cafeNameAr} onChange={(e) => set("cafeNameAr", e.target.value)} />
        </Row>
        <Row label="Address (on receipts)" hint="The seller address is required on a tax invoice. Arabic and English are both fine.">
          <input className="input" placeholder="Street, district, city" value={f.cafeAddress} onChange={(e) => set("cafeAddress", e.target.value)} />
        </Row>
        <Row label="Public URL for room QR codes" hint="The address phones on the office Wi-Fi use to reach this server, e.g. http://192.168.1.50:8080 or https://cafe.twisted.local. Leave blank to use the address you are on now.">
          <input className="input" placeholder="http://192.168.x.x:8080" value={f.publicUrl} onChange={(e) => set("publicUrl", e.target.value)} />
        </Row>
        <Row label="Timezone" hint="Decides what counts as 'today' for order numbers and reports.">
          <input className="input" value={f.timezone} onChange={(e) => set("timezone", e.target.value)} />
        </Row>
        <div className="grid grid-cols-2 gap-3">
          <Row label="VAT % (prices include VAT)"><input className="input font-stat" value={f.vatRate} onChange={(e) => set("vatRate", e.target.value.replace(/[^\d.]/g, ""))} /></Row>
          <Row label="VAT number (on receipt)"><input className="input font-stat" inputMode="numeric" maxLength={15} placeholder="3xxxxxxxxxxxxx3" value={f.vatNumber} onChange={(e) => set("vatNumber", e.target.value.replace(/\D/g, ""))} /></Row>
        </div>
        <Row label="Commercial registration no. (optional)"><input className="input font-stat" value={f.crNumber} onChange={(e) => set("crNumber", e.target.value)} /></Row>
        {!/^3\d{13}3$/.test(f.vatNumber) && (
          <div className="chip bg-yellow text-ink whitespace-normal">
            No valid VAT number yet, so receipts print as a plain receipt without the tax-invoice QR code. A Saudi VAT number is 15 digits, starting and ending with 3.
          </div>
        )}
        <Row label="Receipt footer"><input className="input" value={f.receiptFooter} onChange={(e) => set("receiptFooter", e.target.value)} /></Row>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.autoPrintCounter === "1"} onChange={(e) => set("autoPrintCounter", e.target.checked ? "1" : "0")} />
          Print receipt automatically after each paid counter sale
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.roomOrdering === "open"} onChange={(e) => set("roomOrdering", e.target.checked ? "open" : "closed")} />
          Accept room orders
        </label>
        <button className="btn btn-primary" onClick={() => void save()}>Save settings</button>
      </div>

      <h2 className="text-3xl mt-10">Import from POS2</h2>
      <p className="text-sm text-muted">
        In POS2, export tenant data, unzip it, and pick <b>tenant-export.json</b>. Brings in the menu, coffee-type options,
        tables as rooms (with their PINs as room codes), and past orders for reports. Safe to run again: nothing is duplicated.
      </p>
      <label className="flex items-center gap-2 mt-2 text-sm">
        <input type="checkbox" checked={withOrders} onChange={(e) => setWithOrders(e.target.checked)} /> Include order history
      </label>
      <label className="btn mt-2 cursor-pointer">
        <Upload size={16} /> Choose tenant-export.json
        <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void importPos2(e.target.files[0])} />
      </label>

      <h2 className="text-3xl mt-10">Backup</h2>
      <p className="text-sm text-muted">Downloads the full database (menu, orders, tabs). Keep a copy somewhere safe.</p>
      <a className="btn mt-2" href="/api/backup"><Download size={16} /> Download backup</a>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold block mb-1">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted block mt-1">{hint}</span>}
    </label>
  );
}
