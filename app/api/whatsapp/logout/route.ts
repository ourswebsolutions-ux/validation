import { enforceRateLimit, handler, json } from "@/server/http/api";
import { getWhatsAppSession } from "@/server/whatsapp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unlinks the server's WhatsApp device and deletes its local session files. */
export const POST = handler(async (req) => {
  enforceRateLimit(req, "session", 6);
  const session = getWhatsAppSession();
  await session.logout();
  return json({ ok: true, state: session.getState() });
});
