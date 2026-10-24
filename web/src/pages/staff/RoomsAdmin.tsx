// Admin: rooms, their QR codes, and rotating room codes.
import { useEffect, useState } from "react";
import { ExternalLink, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { api, type Room } from "../../lib/api";
import { useStaff } from "./StaffContext";
import { useToast } from "../../components/Toast";

export default function RoomsAdmin() {
  const { rooms, reloadRooms } = useStaff();
  const toast = useToast();
  const [base, setBase] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    reloadRooms();
    void api<{ url: string }>("/api/base-url").then((r) => setBase(r.url));
  }, [reloadRooms]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); reloadRooms(); if (ok) toast(ok, "ok"); } catch (e) { toast((e as Error).message, "err"); }
  };
  const isLocal = /localhost|127\.0\.0\.1/.test(base);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-4xl mr-4">Rooms</h1>
        <input className="input w-64" placeholder="New room name, e.g. Meeting Room 1" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && void run(() => api("/api/rooms", { body: { name } }).then(() => setName("")))} />
        <button className="btn btn-primary" disabled={!name.trim()} onClick={() => void run(() => api("/api/rooms", { body: { name } }).then(() => setName("")))}>
          <Plus size={16} /> Add room
        </button>
        <div className="flex-1" />
        <button className="btn" onClick={() => confirm("Give every room a new code? Old printed cards stop working.") && void run(() => api("/api/rooms/rotate-all", { body: {} }), "All codes changed. Reprint the cards.")}>
          <RefreshCw size={16} /> New codes for all
        </button>
        <a className="btn btn-cyan" href="/staff/qr-sheet" target="_blank"><Printer size={16} /> Print all cards</a>
      </div>
      <p className="text-sm text-muted mt-2">
        QR codes point to <b className="text-ink">{base}/r/…</b>. The QR stays the same; only the code on the card changes when you rotate it.
        {isLocal && <span className="text-warn"> This is localhost, so phones can't open it. Set the Public URL in Settings to this PC's network address.</span>}
      </p>

      <div className="grid gap-3 mt-4 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
        {rooms.map((r) => <RoomCard key={r.id} r={r} run={run} />)}
      </div>
      {rooms.length === 0 && <div className="text-muted mt-6">No rooms yet. Add one above.</div>}
    </div>
  );
}

function RoomCard({ r, run }: { r: Room; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  return (
    <div className={`card p-4 ${r.active ? "" : "opacity-50"}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-semibold text-lg">{r.name}</div>
          <div className="text-xs text-muted">/r/{r.slug}</div>
        </div>
        <button className="btn btn-ghost p-1 text-danger" onClick={() => confirm(`Remove ${r.name}?`) && void run(() => api(`/api/rooms/${r.id}`, { method: "DELETE" }))}>
          <Trash2 size={16} />
        </button>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <img src={`/api/rooms/${r.id}/qr.svg?v=${r.slug}`} alt="QR" className="h-24 w-24 bg-white rounded p-1" />
        <div>
          <div className="text-xs text-muted">Room code</div>
          <div className="font-stat text-3xl tracking-widest text-secondary">{r.code}</div>
          <div className="text-xs text-muted">since {new Date(r.code_changed_at).toLocaleDateString()}</div>
        </div>
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        <button className="btn text-sm" onClick={() => void run(() => api(`/api/rooms/${r.id}/rotate`, { body: {} }), `New code for ${r.name}`)}>
          <RefreshCw size={14} /> New code
        </button>
        <button className="btn text-sm" onClick={() => {
          const code = prompt("Set code manually", r.code);
          if (code) void run(() => api(`/api/rooms/${r.id}`, { method: "PATCH", body: { code } }));
        }}>Set code</button>
        <button className="btn text-sm" onClick={() => void run(() => api(`/api/rooms/${r.id}`, { method: "PATCH", body: { active: !r.active } }))}>
          {r.active ? "Disable" : "Enable"}
        </button>
        <a className="btn text-sm" href={`/staff/qr-sheet?room=${r.id}`} target="_blank" title="Print card"><Printer size={14} /></a>
        <a className="btn btn-dark text-sm" href={`/r/${r.slug}`} target="_blank" rel="noopener" title="Open this room's order page in a new tab">
          <ExternalLink size={14} /> Open
        </a>
      </div>
    </div>
  );
}
