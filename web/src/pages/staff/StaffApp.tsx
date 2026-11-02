// Staff app shell: PIN login, top nav, sections.
import { useEffect, useState } from "react";
import { Link, useLocation, Route, Switch } from "wouter";
import {
  BarChart3, ClipboardList, Gift, ScrollText, TicketPercent, Coffee, Delete, DoorOpen, LogOut, NotebookPen, Settings as Cog, ShoppingCart, Users, Volume2, VolumeX,
} from "lucide-react";
import { api, type User } from "../../lib/api";
import { reconnectSocket, unlockAudio } from "../../lib/realtime";
import { StaffProvider, useStaff } from "./StaffContext";
import { PrinterButton } from "../../components/PrinterButton";
import { TwistPattern } from "../../components/Brand";
import Counter from "./Counter";
import Board from "./Board";
import Tabs from "./Tabs";
import Reports from "./Reports";
import MenuAdmin from "./MenuAdmin";
import RoomsAdmin from "./RoomsAdmin";
import Team from "./Team";
import SettingsPage from "./SettingsPage";
import Logs from "./Logs";
import Discounts from "./Discounts";
import Rewards from "./Rewards";

export default function StaffApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    document.documentElement.dir = "ltr";
    document.documentElement.lang = "en";
    api<{ user: User | null }>("/api/auth/me").then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  if (user === undefined) return null;
  if (!user) return <Login onIn={(u) => { reconnectSocket(); setUser(u); }} />;
  return (
    <StaffProvider user={user} onLogout={() => { void api("/api/auth/logout", { body: {} }).finally(() => { reconnectSocket(); setUser(null); }); }}>
      <Shell />
    </StaffProvider>
  );
}

function Login({ onIn }: { onIn: (u: User) => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (p: string) => {
    setBusy(true); setErr("");
    try {
      onIn(await api<User>("/api/auth/login", { body: { pin: p } }));
    } catch (e) {
      setErr((e as Error).message);
      setPin("");
    } finally { setBusy(false); }
  };
  const press = (d: string) => {
    unlockAudio();
    if (d === "del") return setPin((p) => p.slice(0, -1));
    if (d === "ok") return void submit(pin);
    setPin((p) => (p.length < 8 ? p + d : p));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
      else if (e.key === "Enter") press("ok");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-panel">
      {/* Brand side: black with the pink twist pattern, like the guideline cover */}
      <div className="relative overflow-hidden bg-ink text-white hidden md:flex flex-col justify-between p-10">
        <TwistPattern className="absolute -right-10 top-0 h-full w-[45%] opacity-95" />
        <div className="relative eyebrow text-white/60">Twisted Minds · Twist The Game</div>
        <div className="relative">
          <img src="/logo.png" alt="Twisted Minds" className="h-20 w-20 mb-6" />
          <div className="ar text-primary text-3xl font-extrabold">مقهى تويستد</div>
          <h1 className="text-7xl">Twisted<br />Cafe</h1>
          <p className="text-white/60 mt-4 max-w-xs font-semibold">Counter, room orders and the barista board, in one place.</p>
        </div>
        <div className="relative text-xs text-white/40">Internal · staff only</div>
      </div>

      <div className="grid place-items-center p-6">
        <div className="w-full max-w-xs text-center">
          <img src="/logo.png" alt="" className="h-14 w-14 mx-auto md:hidden" />
          <div className="ar text-primary font-extrabold text-lg">أدخل الرمز السري</div>
          <h2 className="text-4xl">Enter your PIN</h2>
          <div className="flex justify-center gap-3 my-7 h-4">
            {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
              <span key={i} className={`h-4 w-4 rounded-full transition ${i < pin.length ? "bg-primary scale-110" : "bg-panel-3"}`} />
            ))}
          </div>
          {err && <p className="text-danger font-bold mb-3">{err}</p>}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"].map((d) => (
              <button
                key={d}
                disabled={busy}
                aria-label={d === "del" ? "Delete" : d === "ok" ? "Sign in" : d}
                className={`btn h-[4.5rem] text-2xl font-stat rounded-[1.4rem] ${d === "ok" ? "btn-primary" : d === "del" ? "btn-ghost" : "bg-panel-3"}`}
                onClick={() => press(d)}
              >
                {d === "del" ? <Delete size={24} /> : d === "ok" ? "Go" : d}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { user, orders, logout, settings } = useStaff();
  const [loc] = useLocation();
  const [sound, setSound] = useState(false);
  const admin = user.role === "admin";
  const waiting = orders.filter((o) => o.status === "new").length;

  const nav = [
    { href: "/staff", label: "Counter", icon: ShoppingCart },
    { href: "/staff/orders", label: "Orders", icon: ClipboardList, badge: waiting },
    { href: "/staff/tabs", label: "Tabs", icon: NotebookPen },
    { href: "/staff/rewards", label: "Rewards", icon: Gift },
    { href: "/staff/reports", label: "Reports", icon: BarChart3 },
    ...(admin ? [
      { href: "/staff/menu", label: "Menu", icon: Coffee },
      { href: "/staff/rooms", label: "Rooms", icon: DoorOpen },
      { href: "/staff/discounts", label: "Discounts", icon: TicketPercent },
      { href: "/staff/team", label: "Team", icon: Users },
      { href: "/staff/logs", label: "Logs", icon: ScrollText },
      { href: "/staff/settings", label: "Settings", icon: Cog },
    ] : []),
  ];

  return (
    <div className="h-screen flex flex-col" onPointerDown={() => { unlockAudio(); if (!sound) setSound(true); }}>
      <header className="no-print flex items-center gap-1 px-3 py-2 bg-ink text-white overflow-x-auto">
        <img src="/logo.png" alt="Twisted Minds" className="h-9 w-9 mr-2 shrink-0" />
        {nav.map((n) => {
          const on = n.href === "/staff" ? loc === "/staff" : loc.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`relative flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-extrabold whitespace-nowrap transition ${
                on ? "bg-primary text-white" : "text-white/65 hover:text-white hover:bg-white/10"
              }`}
            >
              <n.icon size={18} strokeWidth={2.4} /> <span className="hidden md:inline">{n.label}</span>
              {!!n.badge && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-cyan text-ink text-xs font-black grid place-items-center pulse">
                  {n.badge}
                </span>
              )}
            </Link>
          );
        })}
        <div className="flex-1" />
        {settings?.roomOrdering === "closed" && <span className="chip bg-yellow text-ink whitespace-nowrap mx-2">Room orders closed</span>}
        <span className="px-2" title={sound ? "Sound on" : "Tap anywhere to enable sound"}>
          {sound ? <Volume2 size={18} className="text-white/70" /> : <VolumeX size={18} className="text-yellow" />}
        </span>
        <PrinterButton paper={settings?.receiptPaper === "58" ? 58 : 80} />
        <span className="text-sm font-bold text-white/70 px-2 whitespace-nowrap">{user.name}</span>
        <button className="btn btn-ghost p-2 text-white hover:bg-white/10" onClick={logout} aria-label="Log out"><LogOut size={18} /></button>
      </header>
      <main className="flex-1 min-h-0 overflow-hidden">
        <Switch>
          <Route path="/staff"><Counter /></Route>
          <Route path="/staff/orders"><Board /></Route>
          <Route path="/staff/tabs"><Tabs /></Route>
          <Route path="/staff/rewards"><Rewards /></Route>
          <Route path="/staff/reports"><Reports /></Route>
          {admin && <Route path="/staff/menu"><MenuAdmin /></Route>}
          {admin && <Route path="/staff/rooms"><RoomsAdmin /></Route>}
          {admin && <Route path="/staff/team"><Team /></Route>}
          {admin && <Route path="/staff/logs"><Logs /></Route>}
          {admin && <Route path="/staff/discounts"><Discounts /></Route>}
          {admin && <Route path="/staff/settings"><SettingsPage /></Route>}
          <Route><div className="p-10 text-muted">Not found.</div></Route>
        </Switch>
      </main>
    </div>
  );
}
