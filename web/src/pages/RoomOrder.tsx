// Customer page opened from a room's QR code: /r/:slug
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DoorOpen, Languages, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { BiTitle, TwistPattern } from "../components/Brand";
import {
  api, ApiError, cartPayload, lineKey, lineLabel, lineUnit, type CartLine, type DiscountPreview, type Item, type Menu, type PublicOrder,
} from "../lib/api";
import { getSocket } from "../lib/realtime";
import { Money } from "../components/Money";
import { ItemPicker } from "../components/ItemPicker";
import { DiscountBox } from "../components/DiscountBox";

const T = {
  en: {
    code: "Room code", codeHint: "Find the code on the card next to the QR.", cont: "Continue",
    name: "Your name", start: "Start ordering", view: "View order", items: "items", order: "Your order",
    note: "Note for the barista (optional)", pay: "How will you pay?", cash: "Cash", card: "Card", tab: "My tab",
    place: "Place order", soldOut: "Sold out", closed: "Room ordering is closed right now. Please order at the counter.",
    notFound: "This room QR is not active.", my: "My orders", change: "change", ordering: "Ordering as",
  },
  ar: {
    code: "رمز الغرفة", codeHint: "تجد الرمز على البطاقة بجانب الباركود.", cont: "متابعة",
    name: "اسمك", start: "ابدأ الطلب", view: "عرض الطلب", items: "منتجات", order: "طلبك",
    note: "ملاحظة للباريستا (اختياري)", pay: "طريقة الدفع", cash: "كاش", card: "بطاقة", tab: "على حسابي",
    place: "أرسل الطلب", soldOut: "نفذ", closed: "الطلب من الغرف مغلق الآن. اطلب من الكاونتر.",
    notFound: "باركود هذه الغرفة غير مفعل.", my: "طلباتي", change: "تغيير", ordering: "الطلب باسم",
  },
};

type Saved = { code: string; name: string };
const savedKey = (slug: string) => `tc-room-${slug}`;
function readJson<T>(k: string, d: T): T {
  try { return JSON.parse(localStorage.getItem(k) || "") ?? d; } catch { return d; }
}
function writeJson(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
}

export default function RoomOrder({ slug }: { slug: string }) {
  const [, nav] = useLocation();
  const [lang, setLang] = useState<"en" | "ar">(() => (localStorage.getItem("tc-lang") === "ar" ? "ar" : "en"));
  const t = T[lang];
  const ar = lang === "ar";
  const [room, setRoom] = useState<{ name: string } | null | "missing">(null);
  const [open, setOpen] = useState(true);
  const [cafe, setCafe] = useState("Twisted Cafe");
  const [saved, setSaved] = useState<Saved | null>(() => readJson<Saved | null>(savedKey(slug), null));
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<Item | null>(null);
  const [sheet, setSheet] = useState(false);
  const [cat, setCat] = useState<number | null>(null);

  useEffect(() => {
    document.documentElement.dir = ar ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    try { localStorage.setItem("tc-lang", lang); } catch { /* ignore */ }
  }, [lang, ar]);

  useEffect(() => {
    api<{ name: string }>(`/api/public/rooms/${slug}`).then(setRoom).catch(() => setRoom("missing"));
    const loadInfo = () => api<{ cafeName: string; roomOrdering: string }>("/api/public/info").then((i) => {
      setCafe(i.cafeName);
      setOpen(i.roomOrdering === "open");
    });
    const loadMenu = () => api<Menu>("/api/public/menu").then(setMenu);
    loadInfo(); loadMenu();
    const s = getSocket();
    s.on("menu-changed", loadMenu);
    s.on("settings-changed", loadInfo);
    return () => { s.off("menu-changed", loadMenu); s.off("settings-changed", loadInfo); };
  }, [slug]);

  const cats = useMemo(() => {
    if (!menu) return [];
    return menu.categories
      .map((c) => ({ ...c, items: menu.items.filter((i) => i.category_id === c.id) }))
      .filter((c) => c.items.length);
  }, [menu]);

  // Drop cart lines whose item disappeared or sold out.
  useEffect(() => {
    if (!menu) return;
    setCart((c) => c.filter((l) => menu.items.some((i) => i.id === l.item.id && i.available)));
  }, [menu]);

  const add = (item: Item, picks: { g: number; c: number }[], qty: number, note: string) => {
    const key = lineKey(item.id, picks, note);
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      if (ex) return c.map((l) => (l.key === key ? { ...l, qty: Math.min(50, l.qty + qty) } : l));
      return [...c, { key, item, qty, picks, note }];
    });
  };
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const total = cart.reduce((s, l) => s + lineUnit(l) * l.qty, 0);

  const header = (
    <header className="relative overflow-hidden bg-ink text-white rounded-b-[2rem]">
      <TwistPattern className="absolute -right-10 top-0 h-full w-32 sm:w-56" />
      <div className="relative max-w-2xl mx-auto px-5 pt-5 pb-7">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Twisted Minds" className="h-11 w-11 object-contain" />
          <div className="flex-1" />
          <MyOrdersLink label={t.my} onGo={(tk) => nav(`/o/${tk}`)} />
          <button className="btn bg-white text-ink py-1.5 px-3 text-sm" onClick={() => setLang(ar ? "en" : "ar")} aria-label="Language">
            <Languages size={16} /> {ar ? "EN" : "عربي"}
          </button>
        </div>
        <div className="mt-6 text-primary font-extrabold text-lg ar">{ar ? cafe : "اطلب إلى غرفتك"}</div>
        <h1 className="text-4xl sm:text-5xl max-w-[14rem] sm:max-w-none">{ar ? "اطلب إلى غرفتك" : "Order to your room"}</h1>
        {room && room !== "missing" && (
          <span className="chip bg-cyan text-ink mt-4 text-sm px-3 py-1"><DoorOpen size={15} /> {room.name}</span>
        )}
      </div>
    </header>
  );

  if (room === "missing") return <>{header}<Center>{t.notFound}</Center></>;
  if (!room || !menu) return <>{header}<Center>…</Center></>;
  if (!open) return <>{header}<Center>{t.closed}</Center></>;
  if (!saved) {
    return (
      <>
        {header}
        <Gate slug={slug} t={t} onDone={(s) => { writeJson(savedKey(slug), s); setSaved(s); }} />
      </>
    );
  }

  const shown = cat == null ? cats : cats.filter((c) => c.id === cat);

  return (
    <div className="min-h-screen pb-28">
      {header}
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-sm text-muted mt-4 flex items-center gap-2 font-semibold">
          {t.ordering} <b className="text-ink font-extrabold">{saved.name}</b>
          <button className="text-primary font-extrabold" onClick={() => { localStorage.removeItem(savedKey(slug)); setSaved(null); }}>{t.change}</button>
        </div>
        <div className="flex gap-2 overflow-x-auto py-3 -mx-4 px-4 sticky top-0 bg-bg/90 backdrop-blur z-10">
          <Chip on={cat == null} onClick={() => setCat(null)}>{ar ? "الكل" : "All"}</Chip>
          {cats.map((c) => (
            <Chip key={c.id} on={cat === c.id} onClick={() => setCat(c.id)}>{ar && c.name_ar ? c.name_ar : c.name}</Chip>
          ))}
        </div>
        {shown.map((c) => (
          <section key={c.id} className="mt-3 mb-7">
            <BiTitle en={ar && c.name_ar ? c.name_ar : c.name} ar={ar ? undefined : c.name_ar} size="text-3xl" className="mb-3" />
            <div className="grid gap-2.5">
              {c.items.map((i) => (
                <button
                  key={i.id}
                  disabled={!i.available}
                  onClick={() => (i.options.length ? setPicking(i) : add(i, [], 1, ""))}
                  className="card p-4 flex items-center gap-3 text-start transition active:scale-[0.99] hover:border-primary disabled:opacity-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-extrabold text-lg leading-tight">{ar && i.name_ar ? i.name_ar : i.name}</div>
                    {(ar ? i.name : i.name_ar) && <div className="text-sm text-muted font-semibold ar">{ar ? i.name : i.name_ar}</div>}
                    {i.description && <div className="text-sm text-muted truncate">{i.description}</div>}
                  </div>
                  {i.available ? <Money v={i.price} className="text-lg" /> : <span className="chip bg-red/10 text-danger">{t.soldOut}</span>}
                  {i.available && (
                    <span className="h-10 w-10 rounded-full bg-primary text-white grid place-items-center shrink-0">
                      <Plus size={20} strokeWidth={3} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {count > 0 && !sheet && (
        <div className="fixed bottom-0 inset-x-0 p-4 pb-5">
          <button className="pop-in btn btn-dark w-full max-w-2xl mx-auto flex py-3 pl-3 pr-5 text-lg justify-between shadow-2xl" onClick={() => setSheet(true)}>
            <span className="h-9 min-w-9 px-2 rounded-full bg-primary grid place-items-center font-stat">{count}</span>
            <span className="flex items-center gap-2"><ShoppingBag size={20} /> {t.view}</span>
            <Money v={total} />
          </button>
        </div>
      )}

      {picking && (
        <ItemPicker
          item={picking}
          ar={ar}
          onClose={() => setPicking(null)}
          onAdd={(p, q, n) => { add(picking, p, q, n); setPicking(null); }}
        />
      )}
      {sheet && (
        <CartSheet
          t={t} ar={ar} cart={cart} setCart={setCart} total={total} slug={slug} saved={saved}
          onClose={() => setSheet(false)}
          onBadCode={() => { localStorage.removeItem(savedKey(slug)); setSaved(null); setSheet(false); }}
          onPlaced={(o) => {
            const mine = readJson<{ token: string; at: string }[]>("tc-my-orders", []);
            writeJson("tc-my-orders", [{ token: o.token, at: o.created_at }, ...mine].slice(0, 10));
            nav(`/o/${o.token}`);
          }}
        />
      )}
    </div>
  );
}

function Gate({ slug, t, onDone }: { slug: string; t: (typeof T)["en"]; onDone: (s: Saved) => void }) {
  const [code, setCode] = useState("");
  const [people, setPeople] = useState<string[] | null>(null);
  const [name, setName] = useState(() => localStorage.getItem("tc-name") || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ people: string[] }>(`/api/public/rooms/${slug}/verify`, { body: { code } });
      setPeople(r.people);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <div className="max-w-sm mx-auto px-4 -mt-3 relative"><div className="card p-6 shadow-xl shadow-black/5">
      {people == null ? (
        <form onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <label className="block text-2xl font-black mb-1">{t.code}</label>
          <p className="text-sm text-muted mb-3">{t.codeHint}</p>
          <input
            className="input text-center text-4xl tracking-[0.4em] font-stat uppercase py-4"
            inputMode="numeric" autoFocus maxLength={12} value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {err && <p className="text-danger font-bold text-sm mt-2">{err}</p>}
          <button className="btn btn-primary w-full mt-5 py-3.5 text-lg" disabled={!code.trim() || busy}>{t.cont}</button>
        </form>
      ) : (
        <form onSubmit={(e) => {
          e.preventDefault();
          try { localStorage.setItem("tc-name", name.trim()); } catch { /* ignore */ }
          onDone({ code: code.trim(), name: name.trim() });
        }}>
          <label className="block text-2xl font-black mb-3">{t.name}</label>
          <input className="input text-lg" autoFocus autoComplete="name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary w-full mt-5 py-3.5 text-lg" disabled={name.trim().length < 2}>{t.start}</button>
        </form>
      )}
    </div></div>
  );
}

function CartSheet({
  t, ar, cart, setCart, total, slug, saved, onClose, onBadCode, onPlaced,
}: {
  t: (typeof T)["en"]; ar: boolean; cart: CartLine[]; setCart: (f: (c: CartLine[]) => CartLine[]) => void; total: number;
  slug: string; saved: Saved; onClose: () => void; onBadCode: () => void; onPlaced: (o: PublicOrder) => void;
}) {
  const [note, setNote] = useState("");
  const [pay, setPay] = useState<"cash" | "card" | "tab">("card");
  const [discount, setDiscount] = useState<DiscountPreview | null>(null);
  const checkDiscount = (code: string) => api<DiscountPreview>("/api/public/discount", {
    body: { room: slug, code: saved.code, name: saved.name, discountCode: code, items: cartPayload(cart) },
  });
  // Re-check when the cart changes (amount and minimum order depend on it).
  const discountCode = discount?.code;
  const recheck = useRef(0);
  useEffect(() => {
    if (!discountCode || !cart.length) return;
    const n = ++recheck.current;
    checkDiscount(discountCode)
      .then((d) => n === recheck.current && setDiscount(d))
      .catch((e) => { if (n === recheck.current) { setDiscount(null); setErr((e as Error).message); } });
  }, [cart, discountCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const finalTotal = total - (discount?.amount ?? 0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const qty = (key: string, d: number) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));

  const place = async () => {
    setBusy(true); setErr("");
    try {
      const o = await api<PublicOrder>("/api/public/orders", {
        body: { room: slug, code: saved.code, name: saved.name, note, payPref: pay, items: cartPayload(cart), discountCode: discount?.code ?? null },
      });
      setCart(() => []);
      onPlaced(o);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) onBadCode();
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 overlay flex items-end justify-center" onClick={onClose}>
      <div className="card w-full max-w-2xl rounded-b-none p-5 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-3xl">{t.order}</h2>
          <button className="btn btn-ghost p-2" onClick={onClose}><X size={20} /></button>
        </div>
        {cart.map((l) => (
          <div key={l.key} className="flex items-center gap-3 py-2 border-b border-border">
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{ar && l.item.name_ar ? l.item.name_ar : l.item.name}</div>
              {(lineLabel(l) || l.note) && <div className="text-sm text-muted">{[lineLabel(l), l.note].filter(Boolean).join(" · ")}</div>}
            </div>
            <button className="btn p-2" onClick={() => qty(l.key, -1)}>{l.qty === 1 ? <Trash2 size={16} /> : <Minus size={16} />}</button>
            <span className="font-stat w-6 text-center">{l.qty}</span>
            <button className="btn p-2" onClick={() => qty(l.key, 1)}><Plus size={16} /></button>
            <Money v={lineUnit(l) * l.qty} className="w-16 justify-end" />
          </div>
        ))}
        <textarea className="input mt-4" rows={2} placeholder={t.note} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        <div className="mt-3">
          <DiscountBox compact ar={ar} applied={discount} onApply={async (c) => setDiscount(await checkDiscount(c))} onRemove={() => setDiscount(null)} />
        </div>
        <div className="mt-4 text-sm font-semibold">{t.pay}</div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {(["card", "cash", "tab"] as const).map((p) => (
            <button key={p} className={`btn py-3 ${pay === p ? "btn-primary" : ""}`} onClick={() => setPay(p)}>{t[p]}</button>
          ))}
        </div>
        {err && <p className="text-danger mt-3">{err}</p>}
        <button className="btn btn-primary w-full mt-5 py-4 text-lg" disabled={busy || cart.length === 0} onClick={() => void place()}>
          {t.place} · {discount && <span className="opacity-70 line-through"><Money v={total} /></span>} <Money v={finalTotal} />
        </button>
      </div>
    </div>
  );
}

function MyOrdersLink({ label, onGo }: { label: string; onGo: (token: string) => void }) {
  const mine = readJson<{ token: string; at: string }[]>("tc-my-orders", [])
    .filter((o) => Date.now() - new Date(o.at).getTime() < 12 * 3600_000);
  if (!mine.length) return null;
  return <button className="btn bg-white/10 text-white py-1.5 px-3 text-sm" onClick={() => onGo(mine[0].token)}>{label}</button>;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`btn whitespace-nowrap py-2 text-sm ${on ? "btn-dark" : "bg-panel border-border"}`}>{children}</button>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="max-w-sm mx-auto px-4 py-12"><div className="card p-8 text-center text-lg font-bold text-muted">{children}</div></div>;
}
