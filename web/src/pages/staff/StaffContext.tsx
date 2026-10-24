// Shared live data for the staff app: orders, menu, settings, rooms, people.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Menu, type Order, type Room, type Settings, type User } from "../../lib/api";
import { chime, getSocket } from "../../lib/realtime";
import { useToast } from "../../components/Toast";

type Ctx = {
  user: User;
  orders: Order[];
  menu: Menu | null;
  settings: Settings | null;
  rooms: Room[];
  people: string[];
  upsertOrder: (o: Order) => void;
  reloadMenu: () => void;
  reloadRooms: () => void;
  reloadPeople: () => void;
  reloadSettings: () => void;
  printOrder: (id: number) => void;
  logout: () => void;
};
const C = createContext<Ctx | null>(null);
export const useStaff = () => useContext(C)!;

export function StaffProvider({ user, onLogout, children }: { user: User; onLogout: () => void; children: ReactNode }) {
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const known = useRef(new Set<number>());

  const loadOrders = useCallback(() => {
    api<Order[]>("/api/orders").then((list) => {
      list.forEach((o) => known.current.add(o.id));
      setOrders(list);
    }).catch(() => {});
  }, []);
  const reloadMenu = useCallback(() => void api<Menu>("/api/menu").then(setMenu).catch(() => {}), []);
  const reloadRooms = useCallback(() => void api<Room[]>("/api/rooms").then(setRooms).catch(() => {}), []);
  const reloadSettings = useCallback(() => void api<Settings>("/api/settings").then(setSettings).catch(() => {}), []);
  const reloadPeople = useCallback(
    () => void api<{ name: string; active: number }[]>("/api/people")
      .then((p) => setPeople(p.filter((x) => x.active).map((x) => x.name))).catch(() => {}),
    [],
  );

  const upsertOrder = useCallback((o: Order) => {
    known.current.add(o.id);
    setOrders((list) => {
      const i = list.findIndex((x) => x.id === o.id);
      if (i < 0) return [o, ...list];
      const next = list.slice();
      next[i] = o;
      return next;
    });
  }, []);

  const printOrder = useCallback((id: number) => {
    window.open(`/staff/print/${id}?auto=1`, "_blank", "width=420,height=700");
  }, []);

  useEffect(() => {
    loadOrders(); reloadMenu(); reloadRooms(); reloadSettings(); reloadPeople();
    const s = getSocket();
    const onOrder = (o: Order) => {
      const fresh = !known.current.has(o.id);
      upsertOrder(o);
      if (fresh && o.source === "room" && o.created_by == null) {
        chime();
        toast(`New room order #${o.number} · ${o.room_name} · ${o.customer_name}`, "info");
        if ("vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
      }
    };
    s.on("order", onOrder);
    s.on("menu-changed", reloadMenu);
    s.on("settings-changed", reloadSettings);
    s.on("connect", loadOrders); // catch up after a dropped connection
    // Safety net if the socket silently stalls.
    const iv = setInterval(loadOrders, 60_000);
    return () => {
      s.off("order", onOrder); s.off("menu-changed", reloadMenu); s.off("settings-changed", reloadSettings);
      s.off("connect", loadOrders); clearInterval(iv);
    };
  }, [loadOrders, reloadMenu, reloadRooms, reloadSettings, reloadPeople, upsertOrder, toast]);

  return (
    <C.Provider value={{
      user, orders, menu, settings, rooms, people, upsertOrder, reloadMenu, reloadRooms, reloadPeople, reloadSettings,
      printOrder, logout: onLogout,
    }}>
      {children}
    </C.Provider>
  );
}
