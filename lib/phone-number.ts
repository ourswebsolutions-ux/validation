import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

export type { CountryCode };

export interface NormalizedNumber {
  /** The raw value as the user provided it (trimmed). */
  original: string;
  /** E.164 representation (e.g. +923245237429) when the number is valid. */
  e164: string | null;
  valid: boolean;
  /** Human readable reason when invalid. */
  reason?: string;
  /** Country detected from the international calling code (ISO 3166-1 alpha-2). */
  country?: CountryCode;
  /** Calling code including "+", e.g. "+92". Set whenever the code could be read. */
  callingCode?: string;
}

const MAX_RAW_LENGTH = 40;

export const COUNTRY_CODE_REQUIRED = "Country code required";
export const INVALID_INTERNATIONAL = "Invalid international number";

/** Strip whitespace, dashes, dots, brackets and invisible characters. Keeps a leading "+". */
export function cleanRaw(raw: string): string {
  let s = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2060\ufeff]/g, "")
    .trim();
  // Strip common "tel:" prefix and surrounding quotes.
  s = s.replace(/^tel:/i, "").replace(/^['"]+|['"]+$/g, "");
  const hasPlus = s.startsWith("+");
  let digits = s.replace(/[^\d]/g, "");
  // International "00" dialing prefix → "+" (an explicit international number, not a guess).
  if (!hasPlus && digits.startsWith("00") && digits.length > 4) {
    return "+" + digits.slice(2);
  }
  if (!digits) return hasPlus ? "+" : "";
  digits = digits.slice(0, 20);
  return hasPlus ? "+" + digits : digits;
}

/**
 * Normalize a phone number to E.164, detecting the country from its international calling code.
 * - Only numbers written with "+" (or the "00" international prefix) are accepted.
 * - Numbers without a country code are rejected with COUNTRY_CODE_REQUIRED — the country is
 *   never guessed or assumed.
 * - Every number is detected independently, so a list may mix any countries.
 */
export function normalizePhoneNumber(raw: string): NormalizedNumber {
  const original = (raw ?? "").toString().trim().slice(0, MAX_RAW_LENGTH * 2);
  if (!original) return { original, e164: null, valid: false, reason: "Empty value" };
  if (/[a-z]{3,}/i.test(original.replace(/^tel:/i, "").replace(/\s*(ext\.?|x)\s*\d+$/i, ""))) {
    return { original, e164: null, valid: false, reason: "Contains letters" };
  }
  const cleaned = cleanRaw(original);
  const digitCount = cleaned.replace(/\D/g, "").length;
  if (!cleaned.startsWith("+")) {
    return { original, e164: null, valid: false, reason: digitCount < 6 ? "Too short" : COUNTRY_CODE_REQUIRED };
  }
  if (digitCount < 6) return { original, e164: null, valid: false, reason: "Too short", ...codeOnly(cleaned) };
  if (digitCount > 15) return { original, e164: null, valid: false, reason: "Too long", ...codeOnly(cleaned) };

  const parsed = parsePhoneNumberFromString(cleaned);
  if (!parsed) {
    return { original, e164: null, valid: false, reason: INVALID_INTERNATIONAL, ...codeOnly(cleaned) };
  }
  const callingCode = "+" + parsed.countryCallingCode;
  const country = parsed.country ?? countryForCallingCode(parsed.countryCallingCode) ?? undefined;
  if (!parsed.isValid()) {
    return { original, e164: null, valid: false, reason: INVALID_INTERNATIONAL, country, callingCode };
  }
  const type = parsed.getType();
  if (type === "PREMIUM_RATE" || type === "TOLL_FREE" || type === "SHARED_COST" || type === "UAN" || type === "VOICEMAIL" || type === "PAGER") {
    return { original, e164: null, valid: false, reason: "Unsupported number type", country, callingCode };
  }
  return { original, e164: parsed.number, valid: true, country, callingCode };
}

/** Best-effort calling code for a number libphonenumber could not parse at all. */
function codeOnly(cleaned: string): { callingCode?: string; country?: CountryCode } {
  const digits = cleaned.slice(1);
  for (const len of [1, 2, 3]) {
    const cc = digits.slice(0, len);
    if (callingCodes().has(cc)) {
      const country = countryForCallingCode(cc) ?? undefined;
      return { callingCode: "+" + cc, ...(country ? { country } : {}) };
    }
  }
  return {};
}

let callingCodeMap: Map<string, CountryCode[]> | null = null;

function callingCodes(): Map<string, CountryCode[]> {
  if (!callingCodeMap) {
    callingCodeMap = new Map();
    for (const c of getCountries()) {
      const cc = getCountryCallingCode(c);
      callingCodeMap.set(cc, [...(callingCodeMap.get(cc) ?? []), c]);
    }
  }
  return callingCodeMap;
}

/** The country for a calling code when it is unambiguous (e.g. 92 → PK, but not 1 or 44). */
function countryForCallingCode(cc: string): CountryCode | null {
  const list = callingCodes().get(cc);
  return list && list.length === 1 ? list[0] : null;
}

/** Strict E.164 check (used by the API for already-normalized input). */
export function isE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

/**
 * Split a free-form blob of numbers on line breaks, commas, semicolons, tabs and pipes.
 * Whitespace-separated tokens are only split when the whole token is not itself a valid
 * number (so "+92 324 5237429" stays one number, but "+923001234567 +14155552671" becomes two).
 */
export function splitNumberList(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/[\r\n,;\t|]+/)) {
    const token = chunk.trim();
    if (!token) continue;
    if (!/\s/.test(token) || normalizePhoneNumber(token).valid) {
      out.push(token);
      continue;
    }
    const parts = token.split(/\s+/).filter(Boolean);
    const anyValid = parts.some((p) => normalizePhoneNumber(p).valid);
    if (anyValid) out.push(...parts);
    else out.push(token);
  }
  return out;
}

export interface DetectedCountry {
  code: CountryCode | null;
  name: string;
  flag: string;
  callingCode: string;
}

function flagEmoji(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const detectCache = new Map<string, DetectedCountry | null>();

/**
 * Country + calling code for display. Works for valid E.164 numbers and, where the calling
 * code is readable, for invalid international input too. Memoized for large tables.
 */
export function detectCountry(value: string | null | undefined): DetectedCountry | null {
  if (!value) return null;
  const hit = detectCache.get(value);
  if (hit !== undefined) return hit;
  const n = normalizePhoneNumber(value);
  let result: DetectedCountry | null = null;
  if (n.callingCode) {
    const name = n.country ? countryName(n.country) : "International";
    result = { code: n.country ?? null, name, flag: n.country ? flagEmoji(n.country) : "🌐", callingCode: n.callingCode };
  }
  if (detectCache.size > 50_000) detectCache.clear();
  detectCache.set(value, result);
  return result;
}

/**
 * Crown Dependencies share the UK's +44 code and libphonenumber identifies them precisely
 * (e.g. +44 7911 1… is a Guernsey mobile range). Label them so the UK link is obvious.
 */
const NAME_OVERRIDES: Partial<Record<CountryCode, string>> = {
  GG: "Guernsey (UK)",
  JE: "Jersey (UK)",
  IM: "Isle of Man (UK)",
};

export function countryName(code: CountryCode): string {
  return NAME_OVERRIDES[code] ?? regionNames()?.of(code) ?? code;
}

let displayNames: Intl.DisplayNames | null | undefined;

function regionNames(): Intl.DisplayNames | null {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      displayNames = null;
    }
  }
  return displayNames;
}

/** Mask a phone number for display, e.g. +92•••••7429 */
export function maskNumber(e164: string): string {
  if (e164.length <= 7) return e164;
  return e164.slice(0, 3) + "•".repeat(Math.max(3, e164.length - 7)) + e164.slice(-4);
}
