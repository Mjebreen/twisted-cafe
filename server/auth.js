// Staff auth: PIN login, signed session cookie (HMAC), no external deps.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const COOKIE = "tc_session";
const SESSION_HOURS = 14;

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dir = process.env.DATA_DIR || path.resolve("data");
  const file = path.join(dir, ".secret");
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const s = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, s);
  return s;
}
const SECRET = loadSecret();

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return `${salt}:${h}`;
}

export function checkPin(pin, stored) {
  const [salt, h] = String(stored).split(":");
  if (!salt || !h) return false;
  const test = crypto.scryptSync(String(pin), salt, 32);
  const want = Buffer.from(h, "hex");
  return want.length === test.length && crypto.timingSafeEqual(want, test);
}

function sign(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function makeToken(user) {
  const payload = Buffer.from(
    JSON.stringify({ uid: user.id, exp: Date.now() + SESSION_HOURS * 3600_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readToken(token) {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = sign(payload);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Set COOKIE_SECURE=1 when the app is served over HTTPS (behind a reverse proxy), so the cookie is never sent over plain HTTP.
const SECURE = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
export function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${SECURE}`;
}
export const clearCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE}`;
export const COOKIE_NAME = COOKIE;

// Simple in-memory rate limiter: max `limit` hits per `windowMs` per key.
export function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length <= limit;
  };
}
