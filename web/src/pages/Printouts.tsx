// Print page: room QR cards (the receipt lives in Receipt.tsx). Opened in a new tab from the staff app.
import { useEffect, useState } from "react";
import { api, type Room, type Settings } from "../lib/api";

export function QrSheet() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [s, setS] = useState<Settings | null>(null);
  const only = new URLSearchParams(location.search).get("room");
  useEffect(() => {
    void api<Room[]>("/api/rooms").then((r) => setRooms(r.filter((x) => x.active && (!only || String(x.id) === only))));
    void api<Settings>("/api/settings").then(setS);
  }, [only]);
  return (
    <div className="qr-sheet min-h-screen">
      <div className="no-print p-3 flex gap-2 bg-panel">
        <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
        <span className="text-ink self-center text-sm">A4 landscape: 2 A5 cards per sheet. Cut along the dashed line. In the print dialog pick A4 and Landscape.</span>
      </div>
      <div className="qr-pages">
        {Array.from({ length: Math.ceil(rooms.length / 2) }, (_, i) => rooms.slice(i * 2, i * 2 + 2)).map((pair, i) => (
          <div key={i} className="qr-sheet-a4">
            {pair.map((r) => (
          <div key={r.id} className="qr-page">
            <img src="/logo.png" alt="" style={{ height: "16mm", margin: "0 auto" }} />
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 34, marginTop: "3mm" }}>{s?.cafeName}</div>
            <div style={{ fontSize: 16 }}>Scan to order to your room · امسح للطلب</div>
            <img src={`/api/rooms/${r.id}/qr.svg`} alt="" style={{ width: "95mm", height: "95mm", margin: "6mm auto" }} />
            <div style={{ fontSize: 30, fontWeight: 800 }}>{r.name}</div>
            <div style={{ fontSize: 15, marginTop: "3mm" }}>Room code · رمز الغرفة</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 54, fontWeight: 800, color: "#FA4B69", letterSpacing: "0.3em", lineHeight: 1.1 }}>{r.code}</div>
          </div>
            ))}
          </div>
        ))}
      </div>
      <style>{`
        .qr-pages { display: flex; flex-direction: column; align-items: center; gap: 8mm; padding: 8mm; background: #eee; }
        .qr-sheet-a4 { width: 297mm; height: 210mm; display: flex; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.15); overflow: hidden; }
        .qr-page { width: 148.5mm; height: 210mm; box-sizing: border-box; padding: 10mm; text-align: center;
          display: flex; flex-direction: column; justify-content: center; }
        .qr-page:first-child { border-right: 0.3mm dashed #999; }
        .qr-page:only-child { border-right: 0.3mm dashed #999; }
        @media print {
          @page { size: A4 landscape; margin: 0; }
          .qr-pages { display: block; padding: 0; gap: 0; background: #fff; }
          .qr-sheet-a4 { box-shadow: none; break-after: page; page-break-after: always; }
          .qr-sheet-a4:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
    </div>
  );
}
