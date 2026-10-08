import { getConfig } from "@/server/config";
import { enforceRateLimit, handler, json } from "@/server/http/api";
import { getWhatsAppSession } from "@/server/whatsapp/client";
import type { QrResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  enforceRateLimit(req, "read", getConfig().rateReadPerMin);
  const session = getWhatsAppSession();
  const body: QrResponse = { state: session.getState(), qr: await session.getQrDataUrl() };
  return json(body);
});
