// Receipt / simplified tax invoice data (ZATCA, Saudi Arabia).
// Prices are VAT-inclusive. A paid order from a VAT-registered seller is a "simplified tax invoice":
// Arabic title, seller name + VAT number, invoice number, issue date/time, items, VAT total,
// total incl. VAT, and a QR code with the 5 Phase 1 TLV fields (seller, VAT no, time, total, VAT).
import QRCode from "qrcode";
import { getSettings } from "./db.js";

/** Saudi VAT numbers: 15 digits, starting and ending with 3. */
export const isVatNumber = (v) => /^3\d{13}3$/.test(String(v || ""));

const sar = (h) => (h / 100).toFixed(2);

/** ZATCA QR payload: tag(1 byte) + length(1 byte) + UTF-8 value, concatenated, then Base64. */
export function zatcaTlv(fields) {
  const parts = fields.map((v, i) => {
    let val = Buffer.from(String(v), "utf8");
    if (val.length > 255) val = val.subarray(0, 255);
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
    : isVatNumber(s.vatNumber) && rate > 0 ? "tax"
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
  return {
    order: o,
    seller: {
      name: s.cafeName, nameAr: s.cafeNameAr, address: s.cafeAddress, vatNumber: s.vatNumber,
      crNumber: s.crNumber, footer: s.receiptFooter, timezone: s.timezone,
    },
    invoice: {
      kind,
      no: `INV-${String(o.id).padStart(6, "0")}`,
      issuedAt: issued,
      rate,
      vat,
      net: o.total - vat,
      vatNumberValid: isVatNumber(s.vatNumber),
      qr,
      qrText,
    },
  };
}
