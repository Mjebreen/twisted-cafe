// Receipt / simplified tax invoice data (ZATCA, Saudi Arabia).
// Prices are VAT-inclusive. A paid order from a VAT-registered seller is a "simplified tax invoice":
// Arabic title, seller name + VAT number, invoice number, issue date/time, items, VAT total,
// total incl. VAT, and a QR code with the 5 Phase 1 TLV fields (seller, VAT no, time, total, VAT).
import QRCode from "qrcode";
import { db, getSettings } from "./db.js";

/** Saudi VAT numbers: 15 digits, starting and ending with 3. */
export const isVatNumber = (v) => /^3\d{13}3$/.test(String(v || ""));

/** True for an IANA timezone name the runtime knows, e.g. "Asia/Riyadh". */
export function isTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

const sar = (h) => (h / 100).toFixed(2);

/** ZATCA QR payload: tag(1 byte) + length(1 byte) + UTF-8 value, concatenated, then Base64. */
export function zatcaTlv(fields) {
  const parts = fields.map((v, i) => {
    // Max 255 bytes per value; trim whole characters so Arabic is never cut mid-letter.
    let str = "";
    let bytes = 0;
    for (const ch of String(v)) {
      const n = Buffer.byteLength(ch, "utf8");
      if (bytes + n > 255) break;
      str += ch;
      bytes += n;
    }
    const val = Buffer.from(str, "utf8");
    return Buffer.concat([Buffer.from([i + 1, val.length]), val]);
  });
  return Buffer.concat(parts).toString("base64");
}

export async function receiptFor(o) {
  const s = getSettings();
  const rate = Number(s.vatRate) || 0;
  const vat = Math.round((o.total * rate) / (100 + rate));
  const issued = o.paid_at || o.created_at;
  const kind = o.status === "cancelled" ? "cancelled"
    : o.payment_status !== "paid" ? "slip"
    // Free / comped orders are not a sale: no tax invoice for them.
    : isVatNumber(s.vatNumber) && rate > 0 && o.total > 0 && o.payment_method !== "free" ? "tax"
    : "receipt";
  const seller = s.cafeNameAr || s.cafeName;
  let qr = null;
  let qrText = null;
  if (kind === "tax") {
    // Timestamp in UTC ISO 8601 without milliseconds, amounts with 2 decimals.
    const ts = new Date(issued).toISOString().replace(/\.\d{3}Z$/, "Z");
    qrText = zatcaTlv([seller, s.vatNumber, ts, sar(o.total), sar(vat)]);
    qr = await QRCode.toString(qrText, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  }
  // Old lines without an Arabic name take it from the menu, but only while the menu item still has the
  // same English name (a renamed item must not put another product's Arabic name on an old invoice).
  const menuAr = db.prepare("SELECT name, name_ar FROM items WHERE id = ?");
  const items = o.items.map((i) => {
    if (i.name_ar || !i.item_id) return i;
    const m = menuAr.get(i.item_id);
    return m && m.name === i.name && m.name_ar ? { ...i, name_ar: m.name_ar } : i;
  });
  return {
    order: { ...o, items },
    seller: {
      name: s.cafeName, nameAr: s.cafeNameAr, address: s.cafeAddress, vatNumber: s.vatNumber,
      crNumber: s.crNumber, footer: s.receiptFooter, timezone: s.timezone,
      paper: s.receiptPaper === "58" ? 58 : 80,
    },
    invoice: {
      kind,
      no: `INV-${String(o.id).padStart(6, "0")}`,
      issuedAt: issued,
      rate,
      vat,
      net: o.total - vat,
      vatNumberValid: isVatNumber(s.vatNumber),
      free: o.total <= 0 || o.payment_method === "free",
      qr,
      qrText,
    },
  };
}
