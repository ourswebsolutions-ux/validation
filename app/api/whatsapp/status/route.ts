import { getConfig } from "@/server/config";
import { enforceRateLimit, handler, json } from "@/server/http/api";
import { getWhatsAppSession } from "@/server/whatsapp/client";
import type { ConnectionStatusResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const cfg = getConfig();
  enforceRateLimit(req, "read", cfg.rateReadPerMin);
  const session = getWhatsAppSession();
  const state = session.getState();
  const body: ConnectionStatusResponse = {
    connected: state === "connected",
    state,
    qrAvailable: state === "qr_required",
    account: session.getMaskedAccount(),
    lastError: session.getLastError(),
    limits: {
      maxNumbersPerRequest: cfg.maxNumbersPerRequest,
      batchSize: cfg.batchSize,
      intervalMs: cfg.intervalMs,
    },
  };
  return json(body);
});
