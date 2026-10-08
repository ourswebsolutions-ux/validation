import "server-only";

/**
 * Next.js may bundle each route handler separately, so plain module-level variables
 * can exist more than once. Long-lived services (the WhatsApp socket, the job queue)
 * are stored on globalThis to guarantee exactly one instance per server process.
 */
export function singleton<T>(key: string, create: () => T): T {
  const g = globalThis as unknown as Record<symbol, T | undefined>;
  const sym = Symbol.for(`wa-checker.${key}`);
  let value = g[sym];
  if (value === undefined) {
    value = create();
    g[sym] = value;
  }
  return value;
}
