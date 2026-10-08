/** Shared types used by both the browser and the API layer. */

export type CheckStatus = "available" | "not_available" | "invalid" | "error" | "pending";

export type ConnectionState =
  | "connected"
  | "connecting"
  | "qr_required"
  | "disconnected"
  | "reconnecting";

export interface ConnectionStatusResponse {
  connected: boolean;
  state: ConnectionState;
  qrAvailable: boolean;
  /** Masked phone number of the linked account (e.g. "+92•••••7429"), when connected. */
  account: string | null;
  lastError: string | null;
  limits: {
    maxNumbersPerRequest: number;
    batchSize: number;
    intervalMs: number;
  };
}

export interface QrResponse {
  state: ConnectionState;
  /** PNG data URL of the QR code, only present while state === "qr_required". */
  qr: string | null;
}

export interface SingleCheckResponse {
  number: string;
  normalizedNumber: string | null;
  /** ISO country detected from the calling code, e.g. "PK". */
  country?: string | null;
  /** Calling code, e.g. "+92". */
  countryCode?: string | null;
  status: CheckStatus;
  checkedAt: number;
  cached?: boolean;
  error?: string;
}

export type JobState = "queued" | "running" | "waiting_connection" | "paused" | "stopped" | "completed";

export interface JobResultItem {
  number: string;
  status: Exclude<CheckStatus, "pending" | "invalid">;
  checkedAt: number;
  error?: string;
}

export interface JobStatusResponse {
  jobId: string;
  state: JobState;
  total: number;
  processed: number;
  counts: { available: number; not_available: number; error: number };
  /** Results starting at `cursor`. */
  results: JobResultItem[];
  nextCursor: number;
}

export interface ApiErrorBody {
  error: string;
  code: string;
}
