import "server-only";
import { singleton } from "../singleton";
import { WhatsAppSession } from "./session";

/** The process-wide WhatsApp session. Started lazily on first use. */
export function getWhatsAppSession(): WhatsAppSession {
  const session = singleton("whatsapp-session", () => new WhatsAppSession());
  void session.ensureStarted();
  return session;
}
