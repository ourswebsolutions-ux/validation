"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { QrCode, RefreshCw, ShieldCheck, Smartphone, Unlink, X } from "lucide-react";
import type { ConnectionInfo } from "@/hooks/useConnection";
import type { ConnectionState } from "@/lib/types";
import { Button, cn, Spinner } from "./ui";

const STATE_META: Record<ConnectionState | "unknown" | "offline", { label: string; dot: string; pill: string }> = {
  connected: { label: "Connected", dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800 ring-emerald-600/20" },
  connecting: { label: "Connecting", dot: "bg-amber-400 animate-pulse", pill: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  reconnecting: { label: "Reconnecting", dot: "bg-amber-400 animate-pulse", pill: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  qr_required: { label: "QR Scan Required", dot: "bg-amber-400", pill: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  disconnected: { label: "Disconnected", dot: "bg-rose-500", pill: "bg-rose-50 text-rose-800 ring-rose-600/20" },
  unknown: { label: "Checking…", dot: "bg-slate-300 animate-pulse", pill: "bg-slate-50 text-slate-600 ring-slate-300" },
  offline: { label: "Server unreachable", dot: "bg-rose-500", pill: "bg-rose-50 text-rose-800 ring-rose-600/20" },
};

export function connectionKey(conn: ConnectionInfo): keyof typeof STATE_META {
  if (conn.unreachable) return "offline";
  return conn.status?.state ?? "unknown";
}

export function ConnectionPill({ conn, onClick, expanded }: { conn: ConnectionInfo; onClick: () => void; expanded: boolean }) {
  const meta = STATE_META[connectionKey(conn)];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls="connection-panel"
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition hover:brightness-95",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:text-sm",
        meta.pill,
      )}
    >
      <span className={cn("size-2 rounded-full", meta.dot)} aria-hidden />
      <span className="hidden text-current/70 sm:inline">WhatsApp:</span>
      {meta.label}
    </button>
  );
}

export function ConnectionPanel({
  conn,
  open,
  onClose,
  onLogout,
}: {
  conn: ConnectionInfo;
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;

  const key = connectionKey(conn);
  const meta = STATE_META[key];
  const state = conn.status?.state;

  return (
    <div
      id="connection-panel"
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label="WhatsApp connection"
      className="animate-fade-in rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-card)] outline-none sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">WhatsApp connection</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
            <span className={cn("size-2 rounded-full", meta.dot)} aria-hidden />
            {meta.label}
            {state === "connected" && conn.status?.account && (
              <span className="text-slate-400">· linked as {conn.status.account}</span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close connection panel">
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="mt-5">
        {key === "offline" && (
          <p className="text-sm text-rose-700">
            The checker server can’t be reached. Make sure the server is running, then try again.
          </p>
        )}

        {state === "qr_required" && (
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
            <div className="grid size-56 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white p-2">
              {conn.qr ? (
                <Image src={conn.qr} alt="WhatsApp link QR code" width={208} height={208} unoptimized className="size-52" />
              ) : (
                <Spinner className="size-6 text-slate-400" />
              )}
            </div>
            <ol className="space-y-2 text-sm leading-6 text-slate-600">
              <li className="flex gap-2">
                <Smartphone className="mt-1 size-4 shrink-0 text-brand-600" aria-hidden />
                <span>Open WhatsApp on your phone.</span>
              </li>
              <li className="flex gap-2">
                <QrCode className="mt-1 size-4 shrink-0 text-brand-600" aria-hidden />
                <span>
                  Go to <strong className="font-medium text-slate-800">Settings → Linked devices → Link a device</strong>{" "}
                  and scan this code.
                </span>
              </li>
              <li className="text-xs text-slate-500">The code refreshes automatically every ~20 seconds.</li>
            </ol>
          </div>
        )}

        {(state === "connecting" || state === "reconnecting") && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Spinner className="text-brand-600" />
            {state === "connecting" ? "Connecting to WhatsApp…" : "Connection dropped. Reconnecting automatically…"}
          </p>
        )}

        {state === "connected" && (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <ShieldCheck className="size-4" aria-hidden />
            Ready to check numbers. Session credentials stay on the server.
          </p>
        )}

        {state === "disconnected" && (
          <p className="text-sm text-slate-600">
            {conn.status?.lastError ?? "WhatsApp is not connected."} Generate a QR code to link a WhatsApp account.
          </p>
        )}

        {conn.status?.lastError && state !== "disconnected" && state !== "connected" && (
          <p className="mt-3 text-xs text-slate-500">{conn.status.lastError}</p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {state !== "connected" && (
          <Button
            variant="primary"
            size="sm"
            loading={conn.busy}
            onClick={conn.reconnect}
            icon={state === "disconnected" ? <QrCode className="size-4" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          >
            {state === "disconnected" ? "Generate QR" : "Reconnect"}
          </Button>
        )}
        {key === "offline" && (
          <Button variant="secondary" size="sm" onClick={conn.refresh} icon={<RefreshCw className="size-4" aria-hidden />}>
            Retry
          </Button>
        )}
        {(state === "connected" || state === "reconnecting") && (
          <Button variant="secondary" size="sm" disabled={conn.busy} onClick={onLogout} icon={<Unlink className="size-4" aria-hidden />}>
            Unlink device
          </Button>
        )}
      </div>
    </div>
  );
}
