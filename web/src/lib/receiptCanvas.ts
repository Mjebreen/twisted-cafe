// Draws a receipt onto a canvas at the printer's dot width (58mm = 384 dots, 80mm = 576 dots),
// for sending to a thermal printer as an image. Printers have no Arabic font, so text is drawn
// here by the browser, which shapes Arabic correctly.
import type { ReceiptData } from "./api";
import { PAY_LABEL } from "./format";
import { PAY_AR, TITLE, formatWhen, money } from "../pages/Receipt";

const FONT = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif';

export const dotsFor = (paper: 58 | 80) => (paper === 58 ? 384 : 576);

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((ok, bad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => bad(new Error("image failed to load"));
    i.src = src;
  });
}

/** Floyd–Steinberg dither a region to pure black/white (for the logo's grey fill). */
function dither(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx;
      const v = g[i] < 128 ? 0 : 255;
      const e = g[i] - v;
      g[i] = v;
      if (xx + 1 < w) g[i + 1] += (e * 7) / 16;
      if (yy + 1 < h) {
        if (xx > 0) g[i + w - 1] += (e * 3) / 16;
        g[i + w] += (e * 5) / 16;
        if (xx + 1 < w) g[i + w + 1] += e / 16;
      }
    }
  }
  for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g[i]; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, x, y);
}

class Pen {
  y: number;
  readonly ctx: CanvasRenderingContext2D;
  readonly W: number;
  readonly pad: number;
  readonly base: number;
  constructor(ctx: CanvasRenderingContext2D, W: number) {
    this.ctx = ctx;
    this.W = W;
    this.pad = W === 384 ? 4 : 8;
    this.base = W === 384 ? 19 : 22;
    this.y = 6;
  }
  font(size: number, bold = false) {
    this.ctx.font = `${bold ? 700 : 500} ${size}px ${FONT}`;
  }
  width(t: string, size: number, bold = false) {
    this.font(size, bold);
    return this.ctx.measureText(t).width;
  }
  text(t: string, x: number, size: number, opts: { bold?: boolean; align?: CanvasTextAlign; rtl?: boolean } = {}) {
    const c = this.ctx;
    this.font(size, opts.bold);
    c.direction = opts.rtl ? "rtl" : "ltr";
    c.textAlign = opts.align ?? "left";
    c.textBaseline = "alphabetic";
    c.fillStyle = "#000";
    c.fillText(t, x, this.y + size);
  }
  /** Word-wrap to maxW; returns lines. */
  wrap(t: string, size: number, maxW: number, bold = false) {
    const words = t.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && this.width(next, size, bold) > maxW) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }
  center(t: string, size: number, bold = false, rtl = /[؀-ۿ]/.test(t[0] ?? "")) {
    for (const line of this.wrap(t, size, this.W - this.pad * 2, bold)) {
      this.text(line, this.W / 2, size, { bold, align: "center", rtl });
      this.y += Math.round(size * 1.35);
    }
  }
  gap(n: number) { this.y += n; }
  rule(dashed = true, thick = 2) {
    const c = this.ctx;
    c.fillStyle = "#000";
    if (!dashed) c.fillRect(this.pad, this.y, this.W - this.pad * 2, thick);
    else for (let x = this.pad; x < this.W - this.pad; x += 10) c.fillRect(x, this.y, 6, thick);
    this.y += thick + 8;
  }
  /** English label left, Arabic label right, optional value at the far right. Shrinks Arabic to fit. */
  line(en: string, ar: string, v?: string, size = this.base, bold = false) {
    const right = this.W - this.pad;
    const vw = v ? this.width(v, size, true) : 0;
    const enW = this.width(en, size, bold);
    let arSize = size;
    const room = () => right - (v ? vw + 8 : 0) - (this.pad + enW + 8);
    while (arSize > 12 && this.width(ar, arSize, bold) > room()) arSize--;
    this.text(en, this.pad, size, { bold });
    if (v) this.text(v, right, size, { bold: true, align: "right" });
    this.text(ar, right - (v ? vw + 8 : 0), arSize, { bold, align: "right", rtl: true });
    this.y += Math.round(size * 1.4);
  }
}

/** Render the receipt; returns a canvas exactly as tall as the content. */
export async function renderReceipt(r: ReceiptData, W = dotsFor(r.seller.paper)): Promise<HTMLCanvasElement> {
  await document.fonts.load(`700 20px "IBM Plex Sans Arabic"`).catch(() => undefined);
  await document.fonts.load(`500 20px "IBM Plex Sans Arabic"`).catch(() => undefined);
  const big = document.createElement("canvas");
  big.width = W;
  big.height = 6000;
  const ctx = big.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, big.height);
  const p = new Pen(ctx, W);
  const { order: o, seller: s, invoice: inv } = r;
  const B = p.base;

  // Logo (dithered so its grey fill prints as a texture, not a black blob)
  try {
    const logo = await loadImage("/logo.png");
    const h = Math.round(W * 0.15);
    const w = Math.round((logo.width / logo.height) * h);
    const x = Math.round((W - w) / 2);
    ctx.drawImage(logo, x, p.y, w, h);
    dither(ctx, x, p.y, w, h);
    p.gap(h + 6);
  } catch { /* no logo, carry on */ }

  if (s.nameAr) p.center(s.nameAr, B + 5, true, true);
  p.center(s.name, B + 4, true, false);
  if (s.address) p.center(s.address, B - 2);
  p.gap(2);
  if (s.vatNumber) p.line("VAT No.", "الرقم الضريبي", s.vatNumber, B - 1);
  if (s.crNumber) p.line("CR No.", "السجل التجاري", s.crNumber, B - 1);
  p.gap(2);
  p.rule(false, 3);
  const [titleEn, titleAr] = TITLE[inv.kind];
  p.center(titleAr, B + 3, true, true);
  p.center(titleEn, B + 2, true, false);
  p.rule(false, 3);

  if (inv.kind !== "slip") p.line("Invoice No.", "رقم الفاتورة", inv.no);
  p.line("Date", "التاريخ", formatWhen(inv.issuedAt, s.timezone));
  p.line("Order", "الطلب", `#${o.number}`, B + 2, true);
  p.line(o.room_name ? "Room" : "Walk-in", o.room_name ? "الغرفة" : "حضوري", o.room_name || undefined);
  if (o.customer_name) p.line("Customer", "العميل", o.customer_name);
  p.rule();

  // Items: name | qty | price | total
  const right = W - p.pad;
  const colTotal = right;
  const colPrice = right - Math.round(W * 0.23);
  const colQty = right - Math.round(W * 0.44);
  const nameW = colQty - Math.round(W * 0.07) - p.pad;
  const hs = B - 4;
  p.text("Item", p.pad, hs, { bold: true });
  p.text("Qty", colQty, hs, { bold: true, align: "right" });
  p.text("Price", colPrice, hs, { bold: true, align: "right" });
  p.text("Total", colTotal, hs, { bold: true, align: "right" });
  p.gap(Math.round(hs * 1.25));
  p.text("الصنف", p.pad, hs, { bold: true, rtl: true, align: "left" });
  p.text("الكمية", colQty, hs, { bold: true, align: "right", rtl: true });
  p.text("السعر", colPrice, hs, { bold: true, align: "right", rtl: true });
  p.text("المجموع", colTotal, hs, { bold: true, align: "right", rtl: true });
  p.gap(Math.round(hs * 1.35));
  p.rule(false, 2);
  for (const i of o.items) {
    const lines = p.wrap(i.name, B, nameW);
    p.text(lines[0], p.pad, B);
    p.text(String(i.qty), colQty, B, { align: "right" });
    p.text(money(i.unit_price), colPrice, B, { align: "right" });
    p.text(money(i.line_total), colTotal, B, { align: "right" });
    p.gap(Math.round(B * 1.3));
    for (const l of lines.slice(1)) { p.text(l, p.pad, B); p.gap(Math.round(B * 1.3)); }
    if (i.name_ar) { p.text(i.name_ar, p.pad + nameW, B - 1, { align: "right", rtl: true }); p.gap(Math.round(B * 1.3)); }
    for (const extra of [i.options_text && `+ ${i.options_text}`, i.note && `* ${i.note}`].filter(Boolean) as string[]) {
      for (const l of p.wrap(extra, B - 3, nameW)) { p.text(l, p.pad, B - 3); p.gap(Math.round((B - 3) * 1.3)); }
    }
    p.gap(3);
  }
  if (o.note) for (const l of p.wrap(`Note / ملاحظة: ${o.note}`, B - 2, W - p.pad * 2)) { p.text(l, p.pad, B - 2); p.gap(Math.round(B * 1.3)); }
  p.rule();

  const subtotal = o.subtotal ?? o.total + o.discount + (o.reward_discount || 0);
  if (o.discount > 0 || o.reward_discount > 0) p.line("Subtotal", "المجموع الفرعي", money(subtotal));
  if (o.discount > 0) p.line(`Discount ${o.discount_code ?? ""}`.trim(), "الخصم", `-${money(o.discount)}`);
  if (o.reward_discount > 0) p.line(`Points (${o.reward_points})`, "خصم النقاط", `-${money(o.reward_discount)}`);
  const vatOn = inv.rate > 0;
  if (vatOn) {
    p.line("Total excl. VAT", "الإجمالي قبل الضريبة", money(inv.net));
    p.line(`VAT ${inv.rate}%`, "ضريبة القيمة المضافة", money(inv.vat));
  }
  p.line(vatOn ? "Total incl. VAT" : "Total", vatOn ? "الإجمالي شامل الضريبة" : "الإجمالي", undefined, B + 1, true);
  const totalSize = B + 14;
  p.text(`${money(o.total)} SAR`, right, totalSize, { bold: true, align: "right" });
  p.text("ر.س", p.pad, totalSize - 4, { bold: true, rtl: true, align: "left" });
  p.gap(Math.round(totalSize * 1.3));
  p.rule();

  const method = o.payment_method || "";
  if (o.payment_status === "paid") {
    p.line(`Paid: ${PAY_LABEL[method] || method}${o.tab_name ? ` (${o.tab_name})` : ""}`, `مدفوع: ${PAY_AR[method] || ""}`);
  } else {
    p.line(`Not paid${o.pay_pref ? ` · ${PAY_LABEL[o.pay_pref]}` : ""}`, "لم يُدفع بعد");
  }
  if (o.created_by_name) p.line("Cashier", "الكاشير", o.created_by_name);
  if (inv.kind === "slip") { p.gap(4); p.center("ليست فاتورة ضريبية", B, true, true); p.center("Not a tax invoice", B, true, false); }
  if (inv.kind === "cancelled") { p.gap(4); p.center("تم إلغاء هذا الطلب", B, true, true); p.center("This order was cancelled", B, true, false); }

  if (inv.qr) {
    const n = Number(/viewBox="0 0 (\d+)/.exec(inv.qr)?.[1]) || 41;
    const mod = Math.max(2, Math.floor((W * 0.62) / n));
    const size = mod * n;
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(inv.qr)}`);
    p.gap(10);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, Math.round((W - size) / 2), p.y, size, size);
    p.gap(size + 8);
  }
  if (s.footer) p.center(s.footer, B - 1);
  p.gap(10);

  const out = document.createElement("canvas");
  out.width = W;
  out.height = Math.ceil(p.y);
  out.getContext("2d")!.drawImage(big, 0, 0);
  return out;
}

/** A short test page: shows the printer works and Arabic prints. */
export async function renderTest(W: number, name: string): Promise<HTMLCanvasElement> {
  await document.fonts.load(`700 20px "IBM Plex Sans Arabic"`).catch(() => undefined);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = 1000;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, c.height);
  const p = new Pen(ctx, W);
  p.center("الطابعة متصلة ✓", p.base + 6, true, true);
  p.center("Printer connected", p.base + 4, true, false);
  p.rule();
  p.center(name, p.base);
  p.center(`${W === 384 ? "58" : "80"}mm · ${W} dots`, p.base);
  p.center(new Date().toLocaleString(), p.base - 2);
  p.gap(10);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = Math.ceil(p.y);
  out.getContext("2d")!.drawImage(c, 0, 0);
  return out;
}
