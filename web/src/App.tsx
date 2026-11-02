import { Redirect, Route, Switch, useLocation } from "wouter";
import RoomOrder from "./pages/RoomOrder";
import OrderStatus from "./pages/OrderStatus";
import StaffApp from "./pages/staff/StaffApp";
import { QrSheet } from "./pages/Printouts";
import { Receipt } from "./pages/Receipt";
import { ToastProvider } from "./components/Toast";

export default function App() {
  const [loc] = useLocation();
  // The staff app stays mounted across its sections, so live data and the order chime survive navigation.
  const staff = (loc === "/staff" || loc.startsWith("/staff/")) &&
    !loc.startsWith("/staff/print/") && !loc.startsWith("/staff/qr-sheet");
  return (
    <ToastProvider>
      {staff ? <StaffApp /> : (
        <Switch>
          <Route path="/r/:slug">{(p) => <RoomOrder slug={p.slug} />}</Route>
          <Route path="/o/:token">{(p) => <OrderStatus token={p.token} />}</Route>
          <Route path="/staff/print/:id">{(p) => <Receipt id={p.id} />}</Route>
          <Route path="/staff/qr-sheet"><QrSheet /></Route>
          <Route path="/"><Redirect to="/staff" /></Route>
          <Route><div className="p-10 text-center text-muted">Page not found.</div></Route>
        </Switch>
      )}
    </ToastProvider>
  );
}
