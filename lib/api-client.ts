import type {
  ApiErrorBody,
  ConnectionStatusResponse,
  JobStatusResponse,
  QrResponse,
  SingleCheckResponse,
} from "./types";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: { ...(rest.body ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    });
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    throw new ApiRequestError(
      aborted ? "The server took too long to respond." : "Network error — check your connection.",
      0,
      aborted ? "timeout" : "network_error",
    );
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body as Partial<ApiErrorBody> | null;
    const retry = Number(res.headers.get("retry-after"));
    throw new ApiRequestError(
      err?.error ?? `Request failed (${res.status}).`,
      res.status,
      err?.code ?? "http_error",
      Number.isFinite(retry) ? retry : undefined,
    );
  }
  return body as T;
}

export const api = {
  status: () => request<ConnectionStatusResponse>("/api/whatsapp/status", { timeoutMs: 10_000 }),
  qr: () => request<QrResponse>("/api/whatsapp/qr", { timeoutMs: 10_000 }),
  reconnect: () => request<{ ok: boolean }>("/api/whatsapp/reconnect", { method: "POST", timeoutMs: 45_000 }),
  logout: () => request<{ ok: boolean }>("/api/whatsapp/logout", { method: "POST", timeoutMs: 30_000 }),
  checkNumber: (number: string) =>
    request<SingleCheckResponse>("/api/check-number", {
      method: "POST",
      body: JSON.stringify({ number }),
      timeoutMs: 60_000,
    }),
  createJob: (numbers: string[]) =>
    request<JobStatusResponse & { invalid: string[] }>("/api/check-numbers", {
      method: "POST",
      body: JSON.stringify({ numbers }),
    }),
  job: (jobId: string, cursor: number) =>
    request<JobStatusResponse>(`/api/check-numbers/${encodeURIComponent(jobId)}?cursor=${cursor}`, {
      timeoutMs: 15_000,
    }),
  jobAction: (jobId: string, action: "pause" | "resume" | "stop") =>
    request<JobStatusResponse>(`/api/check-numbers/${encodeURIComponent(jobId)}`, {
      method: "POST",
      body: JSON.stringify({ action }),
      timeoutMs: 15_000,
    }),
};
