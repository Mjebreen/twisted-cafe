// Small fetch wrapper + shared types.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: string } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET"),
    headers: opts.raw !== undefined ? { "Content-Type": "text/csv" } : opts.body !== undefined ? { "Content-Type": "application/json" } : {},
    body: opts.raw !== undefined ? opts.raw : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data as T;
}

export type OptionGroup = {
  name: string;
  name_ar?: string;
  type: "single" | "multi";
  required: boolean;
  choices: { name: string; price: number }[];
};
export type Category = { id: number; name: string; name_ar: string; sort: number; active: number };
export type Item = {
  id: number; category_id: number; name: string; name_ar: string; description: string; price: number;
  options: OptionGroup[]; available: number; room_orderable: number; sort: number;
};
export type Menu = { categories: Category[]; items: Item[] };

export type OrderItem = {
  id: number; item_id: number; name: string; category_name: string; qty: number; unit_price: number;
  options_text: string; note: string; line_total: number;
};
export type OrderStatus = "new" | "preparing" | "ready" | "completed" | "cancelled";
export type PayMethod = "cash" | "card" | "tab" | "free";
export type Order = {
  id: number; number: number; local_day: string; token: string; source: "counter" | "room";
  room_id: number | null; room_name: string | null; customer_name: string; note: string; status: OrderStatus;
  pay_pref: string | null; payment_status: "unpaid" | "paid"; payment_method: PayMethod | null; tab_name: string | null;
  created_by: number | null; total: number; subtotal: number | null; discount: number; discount_code: string | null; reward_points: number; reward_discount: number; cancel_reason: string | null; created_by_name: string | null; paid_by_name: string | null;
  created_at: string; updated_at: string; ready_at: string | null; completed_at: string | null; paid_at: string | null;
  items: OrderItem[];
};
export type PublicOrder = Pick<Order, "token" | "number" | "status" | "room_name" | "customer_name" | "total" |
  "payment_status" | "payment_method" | "pay_pref" | "note" | "created_at" | "ready_at"> & {
  room_slug: string | null;
  subtotal: number; discount: number; discount_code: string | null; reward_discount: number;
  items: { name: string; qty: number; options_text: string; note: string; line_total: number }[];
};
export type DiscountPreview = { code: string; label: string; amount: number; subtotal: number; total: number };
export type DiscountCode = {
  id: number; code: string; kind: "percent" | "amount"; value: number; max_discount: number | null; min_order: number;
  scope: "all" | "counter" | "room"; starts_on: string | null; ends_on: string | null; max_uses: number | null;
  once_per_person: number; active: number; note: string; created_at: string; uses?: number; given?: number;
};
export type Room = { id: number; name: string; slug: string; code: string; active: number; code_changed_at: string; sort: number };
export type User = { id: number; name: string; role: "admin" | "staff" };
export type Settings = {
  cafeName: string; timezone: string; vatRate: string; vatNumber: string; receiptFooter: string;
  roomOrdering: "open" | "closed"; publicUrl: string; autoPrintCounter: string;
  rewardsEnabled: string; rewardEarnPerSar: string; rewardPointsPerSar: string;
};

/** Cart line used by both the counter and the room ordering page. */
export type CartLine = { key: string; item: Item; qty: number; picks: { g: number; c: number }[]; note: string };

export function lineUnit(l: Pick<CartLine, "item" | "picks">) {
  return l.item.price + l.picks.reduce((s, p) => s + (l.item.options[p.g]?.choices[p.c]?.price || 0), 0);
}
export function lineLabel(l: Pick<CartLine, "item" | "picks">) {
  return l.picks.map((p) => l.item.options[p.g]?.choices[p.c]?.name).filter(Boolean).join(", ");
}
export function cartPayload(cart: CartLine[]) {
  return cart.map((l) => ({ itemId: l.item.id, qty: l.qty, options: l.picks, note: l.note }));
}
export function lineKey(itemId: number, picks: { g: number; c: number }[], note: string) {
  return `${itemId}|${picks.map((p) => `${p.g}.${p.c}`).sort().join(",")}|${note}`;
}
