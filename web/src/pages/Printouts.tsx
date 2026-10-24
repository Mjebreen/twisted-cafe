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
        {o.discount > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><span>{fmt(o.subtotal ?? o.total + o.discount)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Discount ({o.discount_code})</span><span>-{fmt(o.discount)}</span></div>
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
        <span className="text-ink self-center text-sm">A4: 4 cards per page. Cut along the dashed lines.</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, padding: "8mm" }}>
        {rooms.map((r) => (
          <div key={r.id} style={{ border: "1px dashed #999", padding: "8mm", textAlign: "center", breakInside: "avoid", height: "128mm" }}>
            <img src="/logo.png" alt="" style={{ height: 40, margin: "0 auto" }} />
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 28 }}>{s?.cafeName}</div>
            <div style={{ fontSize: 14 }}>Scan to order to your room · امسح للطلب</div>
            <img src={`/api/rooms/${r.id}/qr.svg`} alt="" style={{ width: "55mm", height: "55mm", margin: "4mm auto" }} />
            <div style={{ fontSize: 22, fontWeight: 700 }}>{r.name}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Room code · رمز الغرفة</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 800, color: "#FA4B69", letterSpacing: "0.3em" }}>{r.code}</div>
          </div>
        ))}
      </div>
      <style>{"@media print { @page { size: A4; margin: 0; } }"}</style>
    </div>
  );
}
