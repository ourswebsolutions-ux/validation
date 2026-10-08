import "server-only";
import {
  USyncContactProtocol,
  USyncQuery,
  USyncUser,
  assertNodeErrorFree,
  type BinaryNode,
} from "baileys";
import type { WhatsAppSession } from "./session";

/**
 * The checking engine contract. Anything able to answer "is this E.164 number on WhatsApp?"
 * for a small batch can implement it, so Baileys can be swapped out later.
 */
export interface NumberCheckEngine {
  isReady(): boolean;
  /** Returns a map of E.164 number → registered on WhatsApp. Throws on transport failure. */
  check(numbers: string[]): Promise<Map<string, boolean>>;
}

export class EngineUnavailableError extends Error {
  constructor(message = "WhatsApp is not connected") {
    super(message);
    this.name = "EngineUnavailableError";
  }
}

type USyncProtocol = USyncQuery["protocols"][number];

function nodeText(content: BinaryNode["content"]): string | null {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return Buffer.from(content).toString("utf8");
  return null;
}

/**
 * Same wire format as Baileys' contact protocol, but the parser also returns the phone number
 * echoed back by the server so each answer can be matched to the number that was asked —
 * even when the returned JID differs from the input (e.g. mobile prefix rewrites).
 */
function contactProtocolWithEcho(): USyncProtocol {
  const base = new USyncContactProtocol();
  return {
    name: base.name,
    getQueryElement: () => base.getQueryElement(),
    getUserElement: (user: USyncUser) => base.getUserElement(user),
    parser: (node: BinaryNode) => {
      if (node.tag !== "contact") return null;
      assertNodeErrorFree(node);
      return { exists: node.attrs?.type === "in", phone: nodeText(node.content) };
    },
  };
}

const digitsOf = (v: string) => v.replace(/\D/g, "");

/** Baileys implementation: one USync "contact" query per batch, nothing else. */
export class BaileysCheckEngine implements NumberCheckEngine {
  constructor(private readonly session: WhatsAppSession) {}

  isReady(): boolean {
    return this.session.isConnected();
  }

  async check(numbers: string[]): Promise<Map<string, boolean>> {
    const sock = this.session.getSocket();
    if (!sock) throw new EngineUnavailableError();

    const query = new USyncQuery();
    query.protocols.push(contactProtocolWithEcho());
    for (const n of numbers) query.withUser(new USyncUser().withPhone(n));

    const result = await sock.executeUSyncQuery(query);
    if (!result) throw new Error("WhatsApp returned no result for the lookup");

    const byDigits = new Map(numbers.map((n) => [digitsOf(n), n] as const));
    const out = new Map<string, boolean>();
    for (const entry of result.list) {
      const contact = entry.contact as { exists: boolean; phone: string | null } | null | undefined;
      if (!contact) continue;
      // Prefer the echoed phone; fall back to the JID's user part.
      const echoed = contact.phone ? byDigits.get(digitsOf(contact.phone)) : undefined;
      const fromJid = byDigits.get(digitsOf(entry.id.split("@")[0]?.split(":")[0] ?? ""));
      const key = echoed ?? fromJid;
      if (key) out.set(key, (out.get(key) ?? false) || contact.exists);
    }
    // Numbers the server did not list back are not registered.
    for (const n of numbers) if (!out.has(n)) out.set(n, false);
    return out;
  }
}
