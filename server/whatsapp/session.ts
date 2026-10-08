import "server-only";
import { rm, mkdir } from "node:fs/promises";
import {
  makeWASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState as loadMultiFileAuthState, // not a React hook, despite the name
  type WASocket,
} from "baileys";
import QRCode from "qrcode";
import { getConfig } from "../config";
import { logger } from "../logger";
import type { ConnectionState } from "@/lib/types";
import { maskNumber } from "@/lib/phone-number";

const MAX_RECONNECT_DELAY_MS = 60_000;

/**
 * Owns the single Baileys socket and its lifecycle:
 * start → (QR required → scan) → connected → (drop → reconnecting → connected) …
 * Authentication data lives only in the server-side auth directory.
 */
export class WhatsAppSession {
  private sock: WASocket | null = null;
  private starting: Promise<void> | null = null;
  private state: ConnectionState = "disconnected";
  private qrRaw: string | null = null;
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  private accountId: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private generation = 0;
  /** Set when we must not auto-start (QR expired, logged out, replaced) until the user asks. */
  private waitingForUser = false;
  private listeners = new Set<(state: ConnectionState) => void>();

  getState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === "connected" && this.sock !== null;
  }

  getSocket(): WASocket | null {
    return this.isConnected() ? this.sock : null;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getMaskedAccount(): string | null {
    if (!this.accountId) return null;
    const digits = this.accountId.split("@")[0]?.split(":")[0];
    return digits && /^\d+$/.test(digits) ? maskNumber("+" + digits) : null;
  }

  async getQrDataUrl(): Promise<string | null> {
    if (this.state !== "qr_required" || !this.qrRaw) return null;
    if (!this.qrDataUrl) {
      this.qrDataUrl = await QRCode.toDataURL(this.qrRaw, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    }
    return this.qrDataUrl;
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Start the session if it isn't running yet. Safe to call repeatedly. */
  ensureStarted(): Promise<void> {
    if (this.sock || this.reconnectTimer || this.waitingForUser) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.connect().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  /** Manual reconnect requested by the user (also regenerates an expired QR). */
  async reconnect(): Promise<void> {
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.waitingForUser = false;
    this.teardownSocket();
    this.setState("connecting");
    await this.ensureStarted();
  }

  /** Unlink this device from WhatsApp and wipe the local session. */
  async logout(): Promise<void> {
    this.clearReconnectTimer();
    const sock = this.sock;
    this.generation++;
    if (sock) {
      try {
        await sock.logout();
      } catch (err) {
        logger.warn({ err: (err as Error).message }, "logout request failed; wiping session locally");
      }
    }
    this.teardownSocket();
    await this.wipeAuth();
    this.accountId = null;
    this.lastError = null;
    this.waitingForUser = true;
    this.setState("disconnected");
  }

  private setState(state: ConnectionState) {
    if (this.state === state) return;
    this.state = state;
    if (state !== "qr_required") {
      this.qrRaw = null;
      this.qrDataUrl = null;
    }
    for (const l of this.listeners) {
      try {
        l(state);
      } catch {
        /* listener errors must not break the session */
      }
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardownSocket() {
    const sock = this.sock;
    this.sock = null;
    this.generation++;
    if (!sock) return;
    try {
      sock.ev.removeAllListeners("connection.update");
      sock.ev.removeAllListeners("creds.update");
      sock.end(undefined);
    } catch {
      /* already closed */
    }
  }

  private async wipeAuth() {
    const { authDir } = getConfig();
    await rm(authDir, { recursive: true, force: true });
  }

  private async connect(): Promise<void> {
    const { authDir } = getConfig();
    const generation = ++this.generation;
    if (this.state !== "reconnecting") this.setState("connecting");

    try {
      await mkdir(authDir, { recursive: true, mode: 0o700 });
      const { state: auth, saveCreds } = await loadMultiFileAuthState(authDir);

      let version: [number, number, number] | undefined;
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      } catch {
        version = undefined; // fall back to the version bundled with Baileys
      }

      const baileysLogger = logger.child({ module: "baileys" });
      baileysLogger.level = getConfig().logLevel === "debug" ? "debug" : "error";

      const sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, baileysLogger) },
        logger: baileysLogger,
        browser: Browsers.appropriate("Chrome"),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 30_000,
      });
      if (generation !== this.generation) {
        sock.end(undefined);
        return;
      }
      this.sock = sock;

      sock.ev.on("creds.update", () => {
        saveCreds().catch((err) => logger.error({ err: (err as Error).message }, "failed to persist credentials"));
      });

      sock.ev.on("connection.update", (update) => {
        if (generation !== this.generation) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrRaw = qr;
          this.qrDataUrl = null;
          this.lastError = null;
          this.setState("qr_required");
        }

        if (connection === "open") {
          this.reconnectAttempts = 0;
          this.lastError = null;
          this.accountId = sock.user?.id ?? null;
          this.setState("connected");
          logger.info("WhatsApp connection open");
        }

        if (connection === "close") {
          const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          const wasRegistered = Boolean(auth.creds.registered);
          this.sock = null;
          this.handleClose(code, wasRegistered, lastDisconnect?.error?.message);
        }
      });
    } catch (err) {
      this.sock = null;
      this.lastError = "Could not start the WhatsApp service.";
      logger.error({ err: (err as Error).message }, "failed to start WhatsApp socket");
      this.scheduleReconnect();
    }
  }

  private handleClose(code: number | undefined, wasRegistered: boolean, message?: string) {
    logger.warn({ code, message }, "WhatsApp connection closed");

    if (code === DisconnectReason.loggedOut) {
      // Device was unlinked from the phone: credentials are useless now.
      this.lastError = "This device was logged out from WhatsApp. Scan a new QR code to reconnect.";
      this.accountId = null;
      this.waitingForUser = true;
      void this.wipeAuth().finally(() => this.setState("disconnected"));
      return;
    }
    if (code === DisconnectReason.connectionReplaced) {
      this.lastError = "Session was opened elsewhere. Click reconnect to take it back.";
      this.waitingForUser = true;
      this.setState("disconnected");
      return;
    }
    if (code === DisconnectReason.restartRequired) {
      // Normal right after scanning the QR code.
      this.setState("connecting");
      void this.ensureStarted();
      return;
    }
    if (!wasRegistered) {
      // QR codes expired without being scanned — wait for the user instead of looping forever.
      this.lastError = "QR code expired. Click “Generate QR” to try again.";
      this.waitingForUser = true;
      this.setState("disconnected");
      return;
    }
    this.lastError = "Connection lost. Reconnecting…";
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    this.reconnectAttempts++;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 2000 * 2 ** Math.min(this.reconnectAttempts - 1, 5));
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureStarted();
    }, delay);
    this.reconnectTimer.unref?.();
  }
}
