import Papa from "papaparse";

/** Header names (compared case-, space-, hyphen-, underscore- and camelCase-insensitively). */
export const PHONE_COLUMN_NAMES = [
  "phone",
  "phone_number",
  "phone_no",
  "mobile",
  "mobile_number",
  "mobile_no",
  "number",
  "whatsapp",
  "whatsapp_number",
  "contact",
  "contact_number",
  "cell",
  "cell_phone",
  "tel",
  "telephone",
  "msisdn",
];

/** Words that make a header a phone column even inside a longer name (e.g. "primary_phone"). */
const PHONE_HEADER_WORDS = ["phone", "mobile", "whatsapp", "msisdn", "telephone"];

const MAX_CELL_LENGTH = 200;
const MAX_COLUMNS = 50;
const SAMPLE_ROWS = 500;

export type ColumnDetection =
  /** Exactly one column whose header and values both look like phone numbers. */
  | "detected"
  /** One column looks likely (by values, or by header only) — needs the user's confirmation. */
  | "possible"
  /** Several plausible columns — the user must choose. */
  | "multiple"
  /** Nothing looks like a phone column. */
  | "none";

export interface ColumnInfo {
  index: number;
  header: string;
  headerMatch: boolean;
  /** Share of non-empty sampled values that look like phone numbers (0–1). */
  phoneRatio: number;
  candidate: boolean;
}

export interface ColumnAnalysis {
  detection: ColumnDetection;
  /** Pre-selected column, or null when the user has to choose. */
  selected: number | null;
  columns: ColumnInfo[];
}

export interface ParsedCsv {
  headers: string[];
  /** Data rows (header row excluded), each padded/truncated to headers.length. */
  rows: string[][];
  hasHeader: boolean;
  analysis: ColumnAnalysis;
  truncated: boolean;
}

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

function sanitizeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_CELL_LENGTH);
}

/** "WhatsApp Number", "phone-number", "phoneNumber", "PHONE_NUMBER" → "phonenumber" / "whatsappnumber". */
export function compactHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const COMPACT_NAMES = new Set(PHONE_COLUMN_NAMES.map(compactHeader));

export function isPhoneHeader(h: string): boolean {
  const c = compactHeader(h);
  if (!c) return false;
  return COMPACT_NAMES.has(c) || PHONE_HEADER_WORDS.some((w) => c.includes(w));
}

const PHONEISH = /^\s*(\+|00)?[\d\s().\-]{6,24}\s*$/;

export function looksLikePhone(value: string): boolean {
  return PHONEISH.test(value) && value.replace(/\D/g, "").length >= 6;
}

function phoneRatio(rows: string[][], index: number): number {
  let filled = 0;
  let hits = 0;
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    const v = row[index] ?? "";
    if (!v) continue;
    filled++;
    if (looksLikePhone(v)) hits++;
  }
  return filled === 0 ? 0 : hits / filled;
}

/**
 * Work out which column holds the phone numbers, using both the header name and the values.
 * Never guesses between several plausible columns, and never trusts a header whose values
 * don't look like phone numbers.
 */
export function analyzeColumns(headers: string[], rows: string[][]): ColumnAnalysis {
  const columns: ColumnInfo[] = headers.map((header, index) => ({
    index,
    header,
    headerMatch: isPhoneHeader(header),
    phoneRatio: phoneRatio(rows, index),
    candidate: false,
  }));
  const pick = (detection: ColumnDetection, cands: ColumnInfo[], selected: number | null): ColumnAnalysis => {
    for (const c of cands) c.candidate = true;
    return { detection, selected, columns };
  };

  if (columns.length === 1) {
    const only = columns[0];
    return only.phoneRatio >= 0.5 ? pick("detected", [only], 0) : pick("none", [], null);
  }

  const strong = columns.filter((c) => c.headerMatch && c.phoneRatio >= 0.5);
  if (strong.length === 1) return pick("detected", strong, strong[0].index);
  if (strong.length > 1) return pick("multiple", strong, null);

  const byData = columns.filter((c) => !c.headerMatch && c.phoneRatio >= 0.6);
  const byHeaderOnly = columns.filter((c) => c.headerMatch && c.phoneRatio > 0);
  const weak = [...byData, ...byHeaderOnly];
  if (weak.length === 1) return pick("possible", weak, weak[0].index);
  if (weak.length > 1) return pick("multiple", weak, null);
  return pick("none", [], null);
}

/** Parse CSV text into a sanitized table. Throws CsvError on unusable input. */
export function parseCsvText(text: string, maxRows: number): ParsedCsv {
  const clean = text.replace(/^\ufeff/, "");
  if (!clean.trim()) throw new CsvError("The CSV file is empty.");

  const result = Papa.parse<string[]>(clean, {
    skipEmptyLines: "greedy",
    // Let PapaParse detect , ; \t | delimiters.
    delimitersToGuess: [",", ";", "\t", "|"],
    preview: maxRows + 1,
  });
  const fatal = result.errors.find((e) => e.type === "Delimiter" && result.data.length === 0);
  if (fatal) throw new CsvError("Could not parse the CSV file.");

  let data = result.data
    .map((row) => (Array.isArray(row) ? row.slice(0, MAX_COLUMNS).map(sanitizeCell) : []))
    .filter((row) => row.some((c) => c !== ""));
  if (data.length === 0) throw new CsvError("The CSV file has no rows.");

  const first = data[0];
  const firstRowPhoneish = first.some(looksLikePhone);
  const firstRowKnownHeader = first.some(isPhoneHeader);
  const hasHeader = firstRowKnownHeader || (!firstRowPhoneish && first.some((c) => /[a-z]/i.test(c)));

  const width = Math.max(...data.slice(0, 500).map((r) => r.length));
  const headers = hasHeader
    ? Array.from({ length: width }, (_, i) => first[i] || `Column ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  if (hasHeader) data = data.slice(1);

  const truncated = data.length > maxRows || result.meta.truncated;
  data = data.slice(0, maxRows);
  const rows = data.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  if (rows.length === 0) throw new CsvError("The CSV file only contains a header row.");

  return { headers, rows, hasHeader, analysis: analyzeColumns(headers, rows), truncated };
}

/** Escape one CSV cell and neutralize spreadsheet formula injection. */
export function escapeCsvCell(value: string): string {
  let v = value;
  // E.164 numbers are safe; anything else starting with a formula trigger gets a leading quote.
  if (/^[=+\-@\t\r]/.test(v) && !/^\+\d{6,15}$/.test(v)) v = "'" + v;
  if (/[",\r\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(escapeCsvCell).join(",")).join("\r\n") + "\r\n";
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
