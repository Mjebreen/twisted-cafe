// Customer order tracking page: /o/:token (live updates).
import { useEffect, useState } from "react";
import { Check, Clock, CoffeeIcon, PartyPopper, XCircle } from "lucide-react";
import { api, type PublicOrder } from "../lib/api";
import { getSocket } from "../lib/realtime";
import { Money } from "../components/Money";
import { Blob } from "../components/Brand";
import { PAY_LABEL } from "../lib/format";

const STEPS = [
  { id: "new", label: "Received", label_ar: "تم الاستلام", icon: Clock },
  { id: "preparing", label: "Preparing", label_ar: "قيد التحضير", icon: CoffeeIcon },
  { id: "ready", label: "On its way / ready", label_ar: "جاهز", icon: PartyPopper },
  { id: "completed", label: "Delivered", label_ar: "تم التسليم", icon: Check },
];

export default function OrderStatus({ token }: { token: string }) {
  const [o, setO] = useState<PublicOrder | null | "missing">(null);
  const ar = document.documentElement.lang === "ar" || localStorage.getItem("tc-lang") === "ar";

  useEffect(() => {
    document.documentElement.dir = ar ? "rtl" : "ltr";
    const load = () => api<PublicOrder>(`/api/public/orders/${token}`).then(setO).catch(() => setO("missing"));
    void load();
    const s = getSocket();
    const watch = () => s.emit("watch", token);
    watch();
    s.on("connect", watch);
    s.on("public-order", (x: PublicOrder) => x.token === token && setO(x));
    return () => { s.off("connect", watch); s.off("public-order"); };
  }, [token, ar]);

  if (o === "missing") return <div className="p-10 text-center text-muted">Order not found.</div>;
  if (!o) return <div className="p-10 text-center text-muted">…</div>;
  const idx = STEPS.findIndex((s) => s.id === o.status);

  const cur = STEPS[idx];
  return (
    <div className="min-h-screen pb-10">
      <header className={`relative overflow-hidden rounded-b-[2rem] text-white ${o.status === "cancelled" ? "bg-ink" : "bg-primary"}`}>
        <Blob color="#03FBFE" className="absolute -right-16 -top-10 w-64 opacity-95" />
        <div className="relative max-w-md mx-auto px-5 pt-5 pb-8">
          <img src="/logo.png" alt="Twisted Minds" className="h-11 w-11 rounded-full bg-white p-1" />
          <div className="mt-6 font-extrabold text-white/80">{o.room_name}{o.customer_name ? ` · ${o.customer_name}` : ""}</div>
          <h1 className="text-7xl font-stat">#{o.number}</h1>
          <div className="mt-2 text-2xl font-black">
            {o.status === "cancelled" ? (ar ? "تم الإلغاء" : "Cancelled") : cur ? (ar ? cur.label_ar : cur.label) : ""}
          </div>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4">
        {o.status === "cancelled" ? (
          <div className="card p-5 mt-5 flex items-center gap-3 text-danger font-bold">
            <XCircle /> {ar ? "تم إلغاء الطلب. تواصل مع الكاونتر." : "This order was cancelled. Please contact the counter."}
          </div>
        ) : (
          <ol className="card p-5 mt-5 space-y-1">
            {STEPS.map((s, i) => {
              const done = i <= idx;
              return (
                <li key={s.id} className="flex items-center gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`h-11 w-11 rounded-full grid place-items-center transition ${
                      i === idx ? "bg-primary text-white pulse" : done ? "bg-ink text-white" : "bg-panel-3 text-muted"}`}>
                      <s.icon size={20} strokeWidth={2.5} />
                    </span>
                    {i < STEPS.length - 1 && <span className={`w-1 h-4 rounded-full ${i < idx ? "bg-ink" : "bg-panel-3"}`} />}
                  </div>
                  <span className={`text-lg font-extrabold -mt-4 ${done ? "" : "text-muted"}`}>{ar ? s.label_ar : s.label}</span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="card p-5 mt-4">
          {o.items.map((i, k) => (
            <div key={k} className="flex justify-between gap-3 py-1.5 font-semibold">
              <span><b className="font-stat">{i.qty}×</b> {i.name}{i.options_text && <span className="text-muted"> · {i.options_text}</span>}{i.note && <span className="text-muted"> · {i.note}</span>}</span>
              <Money v={i.line_total} />
            </div>
          ))}
          {o.discount > 0 && (
            <div className="flex justify-between gap-3 py-1.5 font-semibold text-primary border-t-2 border-dashed border-border mt-3 pt-3">
              <span>{ar ? "خصم" : "Discount"} · {o.discount_code}</span>
              <span className="font-stat">−<Money v={o.discount} /></span>
            </div>
          )}
          <div className="flex justify-between items-center border-t-2 border-dashed border-border mt-3 pt-3 text-xl font-black">
            <span>{ar ? "المجموع" : "Total"}</span>
            <Money v={o.total} className="text-2xl" />
          </div>
          <div className="mt-2">
            {o.payment_status === "paid"
              ? <span className="chip bg-cyan text-ink">{ar ? "مدفوع" : "Paid"} · {PAY_LABEL[o.payment_method || ""] ?? ""}</span>
              : <span className="chip bg-panel-3 text-ink">{ar ? "الدفع عند الاستلام" : "Pay on delivery"} · {PAY_LABEL[o.pay_pref || ""] ?? ""}</span>}
          </div>
        </div>
        {o.room_slug && <a className="btn btn-dark w-full mt-4 py-3.5 text-lg" href={`/r/${o.room_slug}`}>{ar ? "طلب آخر" : "Order something else"}</a>}
      </div>
    </div>
  );
}
