import { enforceRateLimit, handler, json } from "@/server/http/api";
import { getWhatsAppSession } from "@/server/whatsapp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  enforceRateLimit(req, "session", 6);
  const session = getWhatsAppSession();
  if (session.getState() === "connected") return json({ ok: true, state: "connected" });
  await session.reconnect();
  return json({ ok: true, state: session.getState() });
});
