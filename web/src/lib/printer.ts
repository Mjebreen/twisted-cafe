// Direct receipt printing to a Bluetooth thermal printer from the browser (no print dialog), like Loyverse.
//  - Web Bluetooth (BLE): Chrome on Android, Windows, Mac. Most cheap printers (GOOJPRT PT-210, MTP-II…)
//    expose a BLE "serial" service.
//  - Web Serial (Bluetooth classic SPP): desktop Chrome, for printers without BLE.
// Both need a secure page (https:// or localhost). The receipt is sent as an ESC/POS raster image,
// so Arabic prints even though the printer has no Arabic font.
import { useSyncExternalStore } from "react";
import { api, type ReceiptData } from "./api";
import { dotsFor, renderReceipt, renderTest } from "./receiptCanvas";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Kind = "ble" | "serial";
export type PrinterState = {
  kind: Kind | null;
  name: string;
  status: "off" | "connecting" | "ready" | "printing" | "error";
  error: string;
};

// Write services/characteristics used by common cheap BLE receipt printers.
const BLE_SERVICES = [
  0x18f0, 0xff00, 0xffe0, 0xfee7, 0xae30, 0xff12, 0xffe5,
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "000018f0-0000-1000-8000-00805f9b34fb",
];
const SPP = "00001101-0000-1000-8000-00805f9b34fb";
const LS = { kind: "printer.kind", name: "printer.name", slow: "printer.slow" };

const nav = navigator as any;
export const bleSupported = () => !!nav.bluetooth;
export const serialSupported = () => !!nav.serial;

let state: PrinterState = {
  kind: (localStorage.getItem(LS.kind) as Kind | null) ?? null,
  name: localStorage.getItem(LS.name) ?? "",
  status: "off",
  error: "",
};
const subs = new Set<() => void>();
function set(p: Partial<PrinterState>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
export function usePrinter() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);
}

let device: any = null; // BluetoothDevice
let ch: any = null; // writable GATT characteristic
let port: any = null; // SerialPort

export const isSlow = () => localStorage.getItem(LS.slow) === "1";
export function setSlow(on: boolean) {
  try { localStorage.setItem(LS.slow, on ? "1" : "0"); } catch { /* private mode */ }
  set({});
}

function remember(kind: Kind | null, name: string) {
  try {
    if (kind) { localStorage.setItem(LS.kind, kind); localStorage.setItem(LS.name, name); }
    else { localStorage.removeItem(LS.kind); localStorage.removeItem(LS.name); }
  } catch { /* private mode */ }
}

async function findWritable(server: any) {
  const services: any[] = await server.getPrimaryServices().catch(() => []);
  for (const svc of services) {
    const chars: any[] = await svc.getCharacteristics().catch(() => []);
    const c = chars.find((x) => x.properties.writeWithoutResponse) ?? chars.find((x) => x.properties.write);
    if (c) return c;
  }
  throw new Error("This printer has no writable Bluetooth service. Try the 'Bluetooth serial' option on a PC.");
}

async function gattConnect() {
  set({ status: "connecting", error: "" });
  const server = await device.gatt.connect();
  ch = await findWritable(server);
  set({ status: "ready", kind: "ble", name: device.name || "Bluetooth printer" });
}

/** Pick a BLE printer (must be called from a tap). */
export async function connectBle() {
  if (!bleSupported()) throw new Error("This browser has no Bluetooth support. Use Chrome.");
  device = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  device.addEventListener("gattserverdisconnected", () => { ch = null; if (state.status !== "off") set({ status: "off" }); });
  try { await gattConnect(); } catch (e) { set({ status: "error", error: (e as Error).message }); throw e; }
  remember("ble", device.name || "Bluetooth printer");
}

/** Pick a Bluetooth-classic / USB serial printer (desktop Chrome; must be called from a tap). */
export async function connectSerial() {
  if (!serialSupported()) throw new Error("Bluetooth serial needs Chrome on a computer.");
  port = await nav.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] });
  await openSerial();
  remember("serial", "Serial printer");
}

async function openSerial() {
  set({ status: "connecting", error: "" });
  try {
    if (!port.writable) await port.open({ baudRate: 9600 });
    set({ status: "ready", kind: "serial", name: "Serial printer" });
  } catch (e) {
    set({ status: "error", error: (e as Error).message });
    throw e;
  }
}

/** Reconnect silently to the printer picked before (after a reload or when it went to sleep). */
export async function reconnect(quiet = false) {
  try {
    if (state.kind === "ble") {
      if (!device && nav.bluetooth?.getDevices) {
        const list: any[] = await nav.bluetooth.getDevices();
        device = list.find((d) => d.name === state.name) ?? list[0] ?? null;
        device?.addEventListener("gattserverdisconnected", () => { ch = null; if (state.status !== "off") set({ status: "off" }); });
      }
      if (device && !(device.gatt.connected && ch)) await gattConnect();
    } else if (state.kind === "serial") {
      if (!port && nav.serial?.getPorts) port = (await nav.serial.getPorts())[0] ?? null;
      if (port) await openSerial();
    }
  } catch (e) {
    set(quiet ? { status: "off" } : { status: "error", error: (e as Error).message });
  }
  if (!quiet && state.status !== "ready" && !state.error) set({ status: "error", error: "Printer not reachable. Tap the printer button and connect again." });
  return state.status === "ready";
}

export async function disconnect() {
  try { device?.gatt?.disconnect(); } catch { /* already gone */ }
  try { await port?.close(); } catch { /* already closed */ }
  device = null; ch = null; port = null;
  remember(null, "");
  set({ kind: null, name: "", status: "off", error: "" });
}

/** A printer was picked on this device (it may need a reconnect before printing). */
export const hasPrinter = () => !!state.kind;

/** Canvas → ESC/POS: init, raster image in bands (GS v 0), feed. */
export function escposRaster(c: HTMLCanvasElement) {
  const W = c.width, H = c.height, bpr = W / 8;
  const px = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const out: number[] = [0x1b, 0x40]; // ESC @ (reset)
  const BAND = 64;
  for (let y0 = 0; y0 < H; y0 += BAND) {
    const h = Math.min(BAND, H - y0);
    out.push(0x1d, 0x76, 0x30, 0x00, bpr & 0xff, bpr >> 8, h & 0xff, h >> 8);
    for (let y = y0; y < y0 + h; y++) {
      for (let bx = 0; bx < bpr; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const i = (y * W + bx * 8 + bit) * 4;
          const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
          if (lum < 150) byte |= 0x80 >> bit;
        }
        out.push(byte);
      }
    }
  }
  out.push(0x1b, 0x64, 0x04); // feed 4 lines so the paper clears the cutter bar
  return new Uint8Array(out);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(bytes: Uint8Array) {
  if (state.kind === "serial") {
    const w = port.writable.getWriter();
    try { await w.write(bytes); } finally { w.releaseLock(); }
    return;
  }
  // BLE: small chunks. Fast mode tries 180-byte writes and drops to 20 if the printer refuses.
  let size = isSlow() ? 20 : 180;
  const pause = isSlow() ? 15 : 0;
  const write = (b: Uint8Array) => (ch.properties.writeWithoutResponse ? ch.writeValueWithoutResponse(b) : ch.writeValueWithResponse(b));
  for (let i = 0; i < bytes.length; ) {
    const part = bytes.subarray(i, i + size);
    try {
      await write(part);
    } catch (e) {
      if (size > 20) { size = 20; continue; }
      throw e;
    }
    i += part.length;
    if (pause) await sleep(pause);
  }
}

async function ready() {
  if (state.status === "ready" && (state.kind === "serial" ? port?.writable : ch)) return;
  if (!(await reconnect())) throw new Error(state.error || "Printer not connected. Tap the printer button to connect.");
}

async function printCanvas(c: HTMLCanvasElement) {
  await ready();
  set({ status: "printing", error: "" });
  try {
    await send(escposRaster(c));
    set({ status: "ready" });
  } catch (e) {
    set({ status: "error", error: (e as Error).message });
    throw e;
  }
}

export async function printReceipt(orderId: number) {
  const r = await api<ReceiptData>(`/api/orders/${orderId}/receipt`);
  await printCanvas(await renderReceipt(r));
}

export async function printTest(paper: 58 | 80) {
  await printCanvas(await renderTest(dotsFor(paper), state.name || "Printer"));
}

// Try the remembered printer once when the app loads (works where the browser allows it silently).
if (state.kind) void reconnect(true);
