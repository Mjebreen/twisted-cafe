// Print pages: 80mm receipt and room QR cards. Opened in a new tab from the staff app.
import { useEffect, useState } from "react";
import { api, type Order, type Room, type Settings } from "../lib/api";
import { fmt, PAY_LABEL } from "../lib/format";

export function Receipt({ id }: { id: string }) {
  const [o, setO] = useState<Order | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState("");
  const auto = new URLSearchParams(location.search).get("auto") === "1";

  useEffect(() => {
    Promise.all([api<Order>(`/api/orders/${id}`), api<Settings>("/api/settings")])
      .then(([a, b]) => { setO(a); setS(b); })
      .catch((e) => setErr((e as Error).message));
  }, [id]);
  useEffect(() => {
    if (!o || !s || !auto) return;
    const t = setTimeout(() => {
      window.print();
      setTimeout(() => window.close(), 500);
    }, 300);
    return () => clearTimeout(t);
  }, [o, s, auto]);

  if (err) return <div className="p-6">{err}</div>;
  if (!o || !s) return null;
  const rate = Number(s.vatRate) || 0;
  const vat = Math.round((o.total * rate) / (100 + rate));

  return (
    <div className="min-h-screen bg-white">
      <div className="no-print p-3 flex gap-2 bg-panel">
        <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
        <button className="btn" onClick={() => window.close()}>Close</button>
      </div>
      <div className="receipt">
        <div style={{ textAlign: "center" }}>
          <img src="/logo.png" alt="" style={{ height: 48, filter: "grayscale(1)" }} />
          <div style={{ fontSize: 16, fontWeight: 700 }}>{s.cafeName}</div>
          {s.vatNumber && <div>VAT No: {s.vatNumber}</div>}
          <div style={{ fontSize: 28, fontWeight: 700, margin: "6px 0" }}>#{o.number}</div>
          <div>{o.room_name ? `ROOM: ${o.room_name}` : "WALK-IN"}</div>
          {o.customer_name && <div>{o.customer_name}</div>}
          <div>{new Date(o.created_at).toLocaleString()}</div>
        </div>
        <hr style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
        {o.items.map((i) => (
          <div key={i.id} style={{ marginBottom: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{i.qty} x {i.name}</span><span>{fmt(i.line_total)}</span>
            </div>
            {i.options_text && <div style={{ paddingLeft: 12 }}>- {i.options_text}</div>}
            {i.note && <div style={{ paddingLeft: 12 }}>* {i.note}</div>}
          </div>
        ))}
        {o.note && <div style={{ marginTop: 4 }}>Note: {o.note}</div>}
        <hr style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
        {(o.discount > 0 || o.reward_discount > 0) && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{fmt(o.subtotal ?? o.total + o.discount + (o.reward_discount || 0))}</span></div>
            {o.discount > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Discount ({o.discount_code})</span><span>-{fmt(o.discount)}</span></div>}
            {o.reward_discount > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Reward points ({o.reward_points})</span><span>-{fmt(o.reward_discount)}</span></div>}
          </>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700 }}>
          <span>TOTAL SAR</span><span>{fmt(o.total)}</span>
        </div>
        {rate > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>incl. VAT {rate}%</span><span>{fmt(vat)}</span>
          </div>
        )}
        <div style={{ marginTop: 4 }}>
          {o.payment_status === "paid"
            ? `PAID: ${PAY_LABEL[o.payment_method || ""]}${o.tab_name ? ` (${o.tab_name})` : ""}`
            : `UNPAID${o.pay_pref ? ` - pay by ${PAY_LABEL[o.pay_pref]}` : ""}`}
        </div>
        {o.created_by_name && <div>Served by: {o.created_by_name}</div>}
        <hr style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
        <div style={{ textAlign: "center" }}>{s.receiptFooter}</div>
      </div>
    </div>
  );
}

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
