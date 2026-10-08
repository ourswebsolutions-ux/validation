"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "@/lib/api-client";
import type { ConnectionStatusResponse } from "@/lib/types";

export interface ConnectionInfo {
  status: ConnectionStatusResponse | null;
  /** True when the status endpoint itself is unreachable. */
  unreachable: boolean;
  qr: string | null;
  busy: boolean;
  refresh: () => Promise<void>;
  reconnect: () => Promise<void>;
  logout: () => Promise<void>;
}

/** Polls the WhatsApp connection state; fetches the QR code only while one is required. */
export function useConnection(onError: (message: string) => void): ConnectionInfo {
  const [status, setStatus] = useState<ConnectionStatusResponse | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const refresh = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      setUnreachable(false);
      if (s.state === "qr_required") {
        const q = await api.qr();
        setQr(q.qr);
      } else {
        setQr(null);
      }
    } catch {
      setUnreachable(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (cancelled) return;
      // Poll faster while something is changing (QR shown, connecting), slower when stable.
      timer = setTimeout(tick, document.hidden ? 15_000 : 4_000);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
      } catch (err) {
        onErrorRef.current(err instanceof ApiRequestError ? err.message : "Request failed.");
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh],
  );

  const reconnect = useCallback(() => run(() => api.reconnect()), [run]);
  const logout = useCallback(() => run(() => api.logout()), [run]);

  return { status, unreachable, qr, busy, refresh, reconnect, logout };
}
