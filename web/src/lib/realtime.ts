import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

/** One shared socket. Call reconnectSocket() after login so the server sees the new cookie. */
export function getSocket() {
  if (!socket) socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
  return socket;
}
export function reconnectSocket() {
  const s = getSocket();
  s.disconnect();
  s.connect();
}

// ── New-order chime (Web Audio, no file needed) ───────────────────
let ctx: AudioContext | null = null;
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no audio */
  }
}
export function chime() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [880, 1175, 1568].forEach((f, i) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.16);
    g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.16 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.35);
    o.connect(g).connect(ctx!.destination);
    o.start(t + i * 0.16);
    o.stop(t + i * 0.16 + 0.4);
  });
}
