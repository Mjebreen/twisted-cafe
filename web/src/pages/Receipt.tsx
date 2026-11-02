// 80mm receipt, bilingual (Arabic + English). For paid orders with a valid VAT number it is a
// ZATCA "simplified tax invoice": title, seller + VAT no, invoice no, date, items, VAT, total, QR.
import { useEffect, useState, type ReactNode } from "react";
import { api, type Order } from "../lib/api";
import { PAY_LABEL } from "../lib/format";

type Kind = "tax" | "receipt" | "slip" | "cancelled";
type ReceiptData = {
  order: Order;
  seller: { name: string; nameAr: string; address: string; vatNumber: string; crNumber: string; footer: string; timezone: string };
  invoice: { kind: Kind; no: string; issuedAt: string; rate: number; vat: number; net: number; vatNumberValid: boolean; free: boolean; qr: string | null };
};

const TITLE: Record<Kind, [string, string]> = {
  tax: ["Simplified Tax Invoice", "فاتورة ضريبية مبسطة"],
  receipt: ["Receipt", "إيصال"],
  slip: ["Order slip · not paid", "طلب · غير مدفوع"],
  cancelled: ["CANCELLED", "ملغي"],
};
const PAY_AR: Record<string, string> = {
  cash: "نقداً", card: "بطاقة", tab: "على الحساب", free: "مجاني",
};
const money = (h: number) => ((h || 0) / 100).toFixed(2);

/** English label left, Arabic label right, value at the end. */
function Line({ en, ar, v, big }: { en: string; ar: string; v?: ReactNode; big?: boolean }) {
  return (
    <div className={`rc-line${big ? " rc-big" : ""}`}>
      <span>{en}</span>
      <span className="rc-ar" dir="rtl">{ar}</span>
      {v !== undefined && <span className="rc-v">{v}</span>}
    </div>
  );
}

/** "2026-11-02 16:29" in the cafe timezone; falls back to Riyadh if the setting is not a valid zone. */
function formatWhen(iso: string, tz: string) {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz || "Asia/Riyadh" }); }
  catch { f = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "Asia/Riyadh" }); }
  return f.format(new Date(iso)).replace(",", "");
}

export function Receipt({ id }: { id: string }) {
  const [r, setR] = useState<ReceiptData | null>(null);
  const [err, setErr] = useState("");
  const auto = new URLSearchParams(location.search).get("auto") === "1";

  useEffect(() => {
    api<ReceiptData>(`/api/orders/${id}/receipt`).then(setR).catch((e) => setErr((e as Error).message));
  }, [id]);
  useEffect(() => {
    if (!r || !auto) return;
    let gone = false;
    // Wait for the Arabic font so the print is not in a fallback font.
    void document.fonts.ready.then(() => setTimeout(() => {
      if (gone) return;
      window.print();
      setTimeout(() => window.close(), 500);
    }, 200));
    return () => { gone = true; };
  }, [r, auto]);

  if (err) return <div className="p-6">{err}</div>;
  if (!r) return null;
  const { order: o, seller: s, invoice: inv } = r;
  const when = formatWhen(inv.issuedAt, s.timezone);
  const subtotal = o.subtotal ?? o.total + o.discount + (o.reward_discount || 0);
  const [titleEn, titleAr] = TITLE[inv.kind];
  const method = o.payment_method || "";
  const vatOn = inv.rate > 0;

  return (
    <div className="receipt-screen">
      <div className="no-print p-3 flex gap-2 items-center bg-panel flex-wrap">
        <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
        <button className="btn" onClick={() => window.close()}>Close</button>
        {inv.kind === "receipt" && (
          <span className="text-sm text-ink">
            {inv.free
              ? "Free order: prints as a plain receipt, not a tax invoice."
              : "No valid VAT number in Settings, so this prints as a plain receipt, not a tax invoice."}
          </span>
        )}
        {inv.kind === "tax" && !s.nameAr && <span className="text-sm text-ink">Tip: add the Arabic cafe name in Settings.</span>}
      </div>
      <div className="receipt">
        <div className="rc-center">
          <img src="/logo.png" alt="" className="rc-logo" />
          {s.nameAr && <div className="rc-name" dir="rtl">{s.nameAr}</div>}
          <div className="rc-name">{s.name}</div>
          {s.address && <div dir="auto">{s.address}</div>}
        </div>
        {s.vatNumber && <Line en="VAT No." ar="الرقم الضريبي" v={s.vatNumber} />}
        {s.crNumber && <Line en="CR No." ar="السجل التجاري" v={s.crNumber} />}
        <div className="rc-center">
          <div className="rc-title">
            <div dir="rtl">{titleAr}</div>
            <div>{titleEn}</div>
          </div>
        </div>
        {inv.kind !== "slip" && <Line en="Invoice No." ar="رقم الفاتورة" v={inv.no} />}
        <Line en="Date" ar="التاريخ" v={when} />
        <Line en="Order" ar="الطلب" v={<b style={{ fontSize: 15 }}>#{o.number}</b>} />
        <Line en={o.room_name ? "Room" : "Walk-in"} ar={o.room_name ? "الغرفة" : "حضوري"} v={o.room_name || ""} />
        {o.customer_name && <Line en="Customer" ar="العميل" v={o.customer_name} />}
        <div className="rc-hr" />
        <div className="rc-items rc-head">
          <span>Item<br /><span dir="rtl">الصنف</span></span>
          <span>Qty<br /><span dir="rtl">الكمية</span></span>
          <span>Price<br /><span dir="rtl">السعر</span></span>
          <span>Total<br /><span dir="rtl">المجموع</span></span>
        </div>
        {o.items.map((i) => (
          <div key={i.id} className="rc-items">
            <span>
              {i.name}
              {i.name_ar && <span className="rc-sub" dir="rtl">{i.name_ar}</span>}
              {i.options_text && <span className="rc-sub">+ {i.options_text}</span>}
              {i.note && <span className="rc-sub">* {i.note}</span>}
            </span>
            <span>{i.qty}</span>
            <span>{money(i.unit_price)}</span>
            <span>{money(i.line_total)}</span>
          </div>
        ))}
        {o.note && <div style={{ marginTop: 4 }}>Note · <span dir="rtl">ملاحظة</span>: {o.note}</div>}
        <div className="rc-hr" />
        {(o.discount > 0 || o.reward_discount > 0) && <Line en="Subtotal" ar="المجموع الفرعي" v={money(subtotal)} />}
        {o.discount > 0 && <Line en={`Discount ${o.discount_code ?? ""}`} ar="الخصم" v={`-${money(o.discount)}`} />}
        {o.reward_discount > 0 && <Line en={`Points (${o.reward_points})`} ar="خصم النقاط" v={`-${money(o.reward_discount)}`} />}
        {vatOn && <Line en="Total excl. VAT" ar="الإجمالي قبل الضريبة" v={money(inv.net)} />}
        {vatOn && <Line en={`VAT ${inv.rate}%`} ar={`ضريبة القيمة المضافة`} v={money(inv.vat)} />}
        <Line big en={vatOn ? "Total incl. VAT" : "Total"} ar={vatOn ? "الإجمالي شامل الضريبة" : "الإجمالي"} />
        <div className="rc-total">{money(o.total)} SAR <span dir="rtl">ر.س</span></div>
        <div className="rc-hr" />
        {o.payment_status === "paid" ? (
          <Line en={`Paid: ${PAY_LABEL[method] || method}${o.tab_name ? ` (${o.tab_name})` : ""}`} ar={`مدفوع: ${PAY_AR[method] || ""}`} />
        ) : (
          <Line en={`Not paid${o.pay_pref ? ` · pay by ${PAY_LABEL[o.pay_pref]}` : ""}`} ar="لم يُدفع بعد" />
        )}
        {o.created_by_name && <Line en="Cashier" ar="الكاشير" v={o.created_by_name} />}
        {inv.kind === "slip" && <div className="rc-center rc-note">Not a tax invoice · <span dir="rtl">ليست فاتورة ضريبية</span></div>}
        {inv.kind === "cancelled" && <div className="rc-center rc-note">This order was cancelled · <span dir="rtl">تم إلغاء هذا الطلب</span></div>}
        {inv.qr && <div className="rc-qr" dangerouslySetInnerHTML={{ __html: inv.qr }} />}
        {s.footer && <div className="rc-center" dir="auto" style={{ marginTop: 6 }}>{s.footer}</div>}
      </div>
    </div>
  );
}
