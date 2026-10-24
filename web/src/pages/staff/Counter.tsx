// Counter POS: tap items, build the order, take payment, send to bar.
import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, Minus, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import {
  api, cartPayload, lineKey, lineLabel, lineUnit, type CartLine, type DiscountPreview, type Item, type Order, type PayMethod,
} from "../../lib/api";
import { useStaff } from "./StaffContext";
import { Money } from "../../components/Money";
import { ItemPicker } from "../../components/ItemPicker";
import { PayDialog } from "../../components/PayDialog";
import { useToast } from "../../components/Toast";
import { DiscountBox } from "../../components/DiscountBox";

export default function Counter() {
  const { menu, rooms, people, upsertOrder, printOrder, settings, reloadPeople, orders } = useStaff();
  const toast = useToast();
  const [cat, setCat] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<Item | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [roomId, setRoomId] = useState<number | "">("");
  const [toBar, setToBar] = useState(true);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [soldOutMode, setSoldOutMode] = useState(false);

  const cats = useMemo(() => (menu?.categories || []).filter((c) => c.active), [menu]);
  const items = useMemo(() => {
    if (!menu) return [];
    const activeCats = new Set(cats.map((c) => c.id));
    const s = q.trim().toLowerCase();
    return menu.items.filter((i) =>
      activeCats.has(i.category_id) &&
      (s ? i.name.toLowerCase().includes(s) || i.name_ar.includes(s) : cat == null || i.category_id === cat));
  }, [menu, cats, cat, q]);

  const add = (item: Item, picks: { g: number; c: number }[], qty: number, n: string) => {
    const key = lineKey(item.id, picks, n);
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      if (ex) return c.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l));
      return [...c, { key, item, qty, picks, note: n }];
    });
  };
  const tap = async (i: Item) => {
    if (soldOutMode) {
      await api(`/api/items/${i.id}/availability`, { method: "PATCH", body: { available: !i.available } });
      return;
    }
    if (!i.available) return toast(`${i.name} is sold out`, "err");
    if (i.options.length) setPicking(i);
    else add(i, [], 1, "");
  };
  const qty = (key: string, d: number) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));
  const subtotal = cart.reduce((s, l) => s + lineUnit(l) * l.qty, 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const [discount, setDiscount] = useState<DiscountPreview | null>(null);
  const total = subtotal - (discount?.amount ?? 0);
  const checkDiscount = (code: string) =>
    api<DiscountPreview>("/api/discounts/check", {
      body: { code, items: cartPayload(cart), customerName: name, roomId: roomId || null },
    });
  // Re-check the code whenever the cart, name or room changes (amount, minimum order, scope).
  const discountCode = discount?.code;
  const recheck = useRef(0);
  useEffect(() => {
    if (!discountCode) return;
    if (!cart.length) { setDiscount(null); return; }
    const n = ++recheck.current;
    const t = setTimeout(() => {
      checkDiscount(discountCode)
        .then((d) => n === recheck.current && setDiscount(d))
        .catch((e) => { if (n === recheck.current) { setDiscount(null); toast(`Discount removed: ${(e as Error).message}`, "err"); } });
    }, 250);
    return () => clearTimeout(t);
  }, [cart, name, roomId, discountCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const unpaidToday = orders.filter((o) => o.payment_status === "unpaid" && o.status !== "cancelled").length;

  const submit = async (payment: { method: PayMethod; tabName?: string } | null) => {
    setBusy(true);
    try {
      const o = await api<Order>("/api/orders", {
        body: {
          items: cartPayload(cart), customerName: name, note, payment, roomId: roomId || null, sendToBar: toBar,
          discountCode: discount?.code ?? null,
        },
      });
      upsertOrder(o);
      setCart([]); setName(""); setNote(""); setRoomId(""); setToBar(true); setPaying(false); setDiscount(null);
      if (payment?.method === "tab") reloadPeople();
      if (settings?.autoPrintCounter === "1" && payment) printOrder(o.id);
      toast(`Order #${o.number} ${payment ? "paid" : "saved, unpaid"}`, "ok", { label: "Print", run: () => printOrder(o.id) });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally { setBusy(false); }
  };

  return (
    <div className="h-full flex">
      {/* Menu side */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b border-border overflow-x-auto">
          <div className="relative shrink-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input py-2 pl-9 w-40" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <CatBtn on={cat == null && !q} onClick={() => { setCat(null); setQ(""); }}>All</CatBtn>
          {cats.map((c) => (
            <CatBtn key={c.id} on={cat === c.id && !q} onClick={() => { setCat(c.id); setQ(""); }}>{c.name}</CatBtn>
          ))}
          <div className="flex-1" />
          <button
            className={`btn text-sm shrink-0 ${soldOutMode ? "btn-danger" : "btn-ghost"}`}
            onClick={() => setSoldOutMode((v) => !v)}
            title="Tap items to mark sold out / back in stock"
          >
            <Ban size={16} /> {soldOutMode ? "Done" : "Sold out"}
          </button>
        </div>
        {soldOutMode && <div className="bg-red/10 text-danger text-sm px-4 py-2">Tap an item to toggle sold out. Room menus update instantly.</div>}
        <div className="flex-1 overflow-y-auto p-3 grid gap-3 content-start grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
          {items.map((i) => (
            <button
              key={i.id}
              onClick={() => void tap(i)}
              className={`card p-3.5 h-32 flex flex-col justify-between text-left active:scale-[0.97] transition shadow-sm ${
                i.available ? "hover:border-primary" : "opacity-40"
              } ${soldOutMode ? "border-dashed" : ""}`}
            >
              <span className="block"><span className="font-extrabold text-[1.05rem] leading-tight line-clamp-2">{i.name}</span>{i.name_ar && <span className="ar block text-sm text-muted font-semibold">{i.name_ar}</span>}</span>
              <span className="flex items-center justify-between w-full">
                <Money v={i.price} className="text-lg" />
                {!i.available && <span className="chip bg-red text-white">SOLD OUT</span>}
                {i.available && i.options.length > 0 && <span className="chip bg-primary/10 text-primary">options</span>}
              </span>
            </button>
          ))}
          {menu && items.length === 0 && <div className="text-muted p-6">No items.</div>}
        </div>
      </div>

      {/* Cart side */}
      <aside className="w-[340px] lg:w-[390px] shrink-0 border-l border-border bg-panel flex flex-col">
        <div className="p-3 space-y-2 border-b border-border">
          <input className="input" list="counter-people" placeholder="Customer name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="counter-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
          <select className="input" value={roomId} onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Walk-in (counter)</option>
            {rooms.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>Deliver to {r.name}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 && (
            <div className="text-center p-10">
              <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 text-primary grid place-items-center"><ShoppingBag size={28} /></div>
              <div className="ar text-primary font-extrabold mt-3">اضغط على الأصناف</div>
              <div className="font-black text-xl">Tap items to add</div>
            </div>
          )}
          {cart.map((l) => (
            <div key={l.key} className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{l.item.name}</div>
                {(lineLabel(l) || l.note) && <div className="text-xs text-muted truncate">{[lineLabel(l), l.note].filter(Boolean).join(" · ")}</div>}
                <Money v={lineUnit(l) * l.qty} className="text-sm" />
              </div>
              <button className="btn p-2" onClick={() => qty(l.key, -1)}>{l.qty === 1 ? <Trash2 size={16} /> : <Minus size={16} />}</button>
              <span className="font-stat w-6 text-center">{l.qty}</span>
              <button className="btn p-2" onClick={() => qty(l.key, 1)}><Plus size={16} /></button>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-border space-y-2">
          {cart.length > 0 && (
            <DiscountBox applied={discount} onApply={async (c) => setDiscount(await checkDiscount(c))} onRemove={() => setDiscount(null)} />
          )}
          <input className="input py-2 text-sm" placeholder="Order note" value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={toBar} onChange={(e) => setToBar(e.target.checked)} className="h-5 w-5 accent-[#FA4B69]" />
            Send to barista board (untick if handed over now)
          </label>
          <div className="flex items-center justify-between text-xl">
            <span className="text-muted">{count} items{discount ? <> · <s><Money v={subtotal} /></s></> : null}</span>
            <Money v={total} className="text-4xl" />
          </div>
          <div className="flex gap-2">
            <button className="btn flex-1 py-3" disabled={!cart.length} onClick={() => { setCart([]); setDiscount(null); }}>Clear</button>
            <button className="btn btn-primary flex-[2] py-3 text-lg" disabled={!cart.length || busy} onClick={() => setPaying(true)}>
              Charge
            </button>
          </div>
          {unpaidToday > 0 && <div className="text-xs text-warn text-center">{unpaidToday} order(s) still unpaid · see Orders</div>}
        </div>
      </aside>

      {picking && (
        <ItemPicker item={picking} onClose={() => setPicking(null)} onAdd={(p, n, nt) => { add(picking, p, n, nt); setPicking(null); }} />
      )}
      {paying && (
        <PayDialog
          total={total}
          people={people}
          defaultTab={name}
          allowLater
          busy={busy}
          onClose={() => setPaying(false)}
          onPay={(p) => void submit(p)}
        />
      )}
    </div>
  );
}

function CatBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`btn shrink-0 py-2 text-sm ${on ? "btn-dark" : "bg-panel border-border"}`} onClick={onClick}>{children}</button>;
}
