// Money is integer halalas everywhere. 1650 → "16.50", 1600 → "16".
export function fmt(h: number) {
  const v = (h || 0) / 100;
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function clock(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const PAY_LABEL: Record<string, string> = {
  cash: "Cash", card: "Card", tab: "Tab", free: "Free", unpaid: "Unpaid", payroll: "Payroll", writeoff: "Write-off",
};
export const STATUS_LABEL: Record<string, string> = {
  new: "New", preparing: "Preparing", ready: "Ready", completed: "Done", cancelled: "Cancelled",
};

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
