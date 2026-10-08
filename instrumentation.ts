/** Start the WhatsApp session as soon as the Node.js server boots (not on the edge). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getWhatsAppSession } = await import("./server/whatsapp/client");
    getWhatsAppSession();
  }
}
