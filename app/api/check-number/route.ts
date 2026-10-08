import { getConfig } from "@/server/config";
import { ApiError, enforceRateLimit, handler, json, readJson } from "@/server/http/api";
import { getWhatsAppSession } from "@/server/whatsapp/client";
import { EngineUnavailableError, TimeoutError, getCheckQueue } from "@/server/whatsapp/queue";
import { normalizePhoneNumber } from "@/lib/phone-number";
import { singleCheckSchema } from "@/lib/validation";
import type { SingleCheckResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  enforceRateLimit(req, "single", getConfig().rateSinglePerMin);
  const { number } = await readJson(req, singleCheckSchema);

  const normalized = normalizePhoneNumber(number);
  if (!normalized.valid || !normalized.e164) {
    const body: SingleCheckResponse = {
      number,
      normalizedNumber: null,
      country: normalized.country ?? null,
      countryCode: normalized.callingCode ?? null,
      status: "invalid",
      checkedAt: Date.now(),
      error: normalized.reason,
    };
    return json(body);
  }

  const session = getWhatsAppSession();
  try {
    const { exists, cached, at } = await getCheckQueue().checkSingle(normalized.e164);
    const body: SingleCheckResponse = {
      number,
      normalizedNumber: normalized.e164,
      country: normalized.country ?? null,
      countryCode: normalized.callingCode ?? null,
      status: exists ? "available" : "not_available",
      checkedAt: at,
      cached,
    };
    return json(body);
  } catch (err) {
    if (err instanceof EngineUnavailableError) {
      const state = session.getState();
      throw new ApiError(
        503,
        state === "qr_required" ? "qr_required" : "whatsapp_disconnected",
        state === "qr_required"
          ? "WhatsApp is not linked yet. Scan the QR code first."
          : "WhatsApp is not connected. Reconnect and try again.",
      );
    }
    if (err instanceof TimeoutError) throw new ApiError(504, "timeout", "WhatsApp did not answer in time.");
    throw new ApiError(502, "check_failed", "The WhatsApp lookup failed. Please retry.");
  }
});
