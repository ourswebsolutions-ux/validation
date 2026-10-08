import { normalizePhoneNumber } from "./phone-number";
import type { CheckStatus } from "./types";

export interface NumberEntry {
  id: number;
  original: string;
  normalized: string | null;
  status: CheckStatus;
  reason?: string;
  checkedAt?: number;
  /** 1-based CSV data row, when imported from a CSV file. */
  row?: number;
  cached?: boolean;
}

export interface PrepStats {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
}

export interface RawNumber {
  value: string;
  row?: number;
}

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Detect each number's country from its calling code, validate, normalize to E.164 and
 * de-duplicate on the E.164 value (so differently formatted copies count once).
 * Processes in slices and yields between them so large lists never freeze the page.
 */
export async function prepareNumbers(
  raws: RawNumber[],
  maxNumbers: number,
): Promise<{ entries: NumberEntry[]; stats: PrepStats; truncated: boolean }> {
  const truncated = raws.length > maxNumbers;
  const input = raws.slice(0, maxNumbers);
  const seen = new Set<string>();
  const entries: NumberEntry[] = [];
  let valid = 0;
  let invalid = 0;
  let duplicates = 0;

  for (let i = 0; i < input.length; i++) {
    if (i > 0 && i % 1500 === 0) await yieldToBrowser();
    const { value, row } = input[i];
    const n = normalizePhoneNumber(value);
    const key = n.valid && n.e164 ? n.e164 : `raw:${n.original}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    if (n.valid && n.e164) valid++;
    else invalid++;
    entries.push({
      id: entries.length + 1,
      original: n.original,
      normalized: n.e164,
      status: n.valid ? "pending" : "invalid",
      ...(n.reason ? { reason: n.reason } : {}),
      ...(row !== undefined ? { row } : {}),
    });
  }
  return { entries, stats: { total: input.length, valid, invalid, duplicates }, truncated };
}

/** Unique normalized E.164 numbers in list order, optionally only WhatsApp-available ones. */
export function uniqueNumbers(entries: NumberEntry[], onlyAvailable: boolean): string[] {
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.normalized) continue;
    if (onlyAvailable && e.status !== "available") continue;
    seen.add(e.normalized);
  }
  return [...seen];
}
