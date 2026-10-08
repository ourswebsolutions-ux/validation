import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRY_CODE_REQUIRED,
  INVALID_INTERNATIONAL,
  detectCountry,
  normalizePhoneNumber,
  splitNumberList,
} from "../lib/phone-number";
import { prepareNumbers, uniqueNumbers, type NumberEntry } from "../lib/prepare";

const cases: [input: string, e164: string, country: string, name: string, code: string][] = [
  ["+92 324 5237429", "+923245237429", "PK", "Pakistan", "+92"],
  ["+44 7400 123456", "+447400123456", "GB", "United Kingdom", "+44"],
  // +44 7911 1… is allocated to Guernsey, which shares the UK's +44 code.
  ["+44 7911 123456", "+447911123456", "GG", "Guernsey (UK)", "+44"],
  ["+1 (415) 555-2671", "+14155552671", "US", "United States", "+1"],
  ["+1 416-555-0123", "+14165550123", "CA", "Canada", "+1"],
  ["+971 50 123 4567", "+971501234567", "AE", "United Arab Emirates", "+971"],
  ["+91 98765-43210", "+919876543210", "IN", "India", "+91"],
];

test("detects the country of each number from its calling code", () => {
  for (const [input, e164, country, name, code] of cases) {
    const n = normalizePhoneNumber(input);
    assert.equal(n.valid, true, input);
    assert.equal(n.e164, e164, input);
    assert.equal(n.country, country, input);
    assert.equal(n.callingCode, code, input);
    const d = detectCountry(e164);
    assert.equal(d?.name, name, input);
    assert.equal(d?.callingCode, code, input);
  }
});

test("handles spaces, hyphens, brackets, dots and the 00 international prefix", () => {
  for (const v of ["+923245237429", "+92 324 5237429", "+92-324-5237429", "+92 (324) 523.7429", "0092 324 5237429", " +92\t3245237429 "]) {
    assert.equal(normalizePhoneNumber(v).e164, "+923245237429", v);
  }
});

test("never guesses a country for numbers without a country code", () => {
  for (const v of ["03245237429", "3245237429", "923245237429", "(415) 555-2671"]) {
    const n = normalizePhoneNumber(v);
    assert.equal(n.valid, false, v);
    assert.equal(n.e164, null, v);
    assert.equal(n.reason, COUNTRY_CODE_REQUIRED, v);
    assert.equal(n.country, undefined, v);
  }
});

test("rejects invalid international numbers but still reports the detected code", () => {
  const short = normalizePhoneNumber("+92 324 52");
  assert.equal(short.valid, false);
  assert.equal(short.reason, INVALID_INTERNATIONAL);
  assert.equal(short.callingCode, "+92");
  assert.equal(normalizePhoneNumber("+999123456789").valid, false);
  assert.equal(normalizePhoneNumber("12345").reason, "Too short");
  assert.equal(normalizePhoneNumber("hello world").valid, false);
  assert.equal(normalizePhoneNumber("+").valid, false);
});

test("splits on line breaks, commas, semicolons and spaces", () => {
  const text = "+923245237429\n+447911123456, +14155552671;+971501234567\n+919876543210 +923001234567";
  assert.deepEqual(splitNumberList(text), [
    "+923245237429",
    "+447911123456",
    "+14155552671",
    "+971501234567",
    "+919876543210",
    "+923001234567",
  ]);
  assert.deepEqual(splitNumberList("+92 324 5237429"), ["+92 324 5237429"]);
});

test("mixed-country list: each number detected independently, duplicates removed by E.164", async () => {
  const raws = [
    "+923245237429",
    "+92 324 5237429",
    "+92-324-5237429",
    "+447911123456",
    "+14155552671",
    "+971501234567",
    "+919876543210",
    "03245237429",
    "+92 324",
  ].map((value) => ({ value }));
  const { entries, stats } = await prepareNumbers(raws, 1000);
  assert.deepEqual(stats, { total: 9, valid: 5, invalid: 2, duplicates: 2 });
  assert.deepEqual(
    entries.map((e) => [e.normalized, e.status, detectCountry(e.normalized ?? e.original)?.callingCode ?? null]),
    [
      ["+923245237429", "pending", "+92"],
      ["+447911123456", "pending", "+44"],
      ["+14155552671", "pending", "+1"],
      ["+971501234567", "pending", "+971"],
      ["+919876543210", "pending", "+91"],
      [null, "invalid", null],
      [null, "invalid", "+92"],
    ],
  );
  assert.equal(entries[5].reason, COUNTRY_CODE_REQUIRED);
});

test("prepareNumbers enforces the maximum list size", async () => {
  const raws = Array.from({ length: 30 }, (_, i) => ({ value: `+9230012345${String(i).padStart(2, "0")}` }));
  const { entries, truncated } = await prepareNumbers(raws, 10);
  assert.equal(entries.length, 10);
  assert.equal(truncated, true);
});

test("copy helpers: valid = unique available E.164 only; all = unique normalized only", () => {
  const e = (id: number, normalized: string | null, status: NumberEntry["status"]): NumberEntry => ({
    id,
    original: normalized ?? "x",
    normalized,
    status,
  });
  const entries = [
    e(1, "+923245237429", "available"),
    e(2, "+447911123456", "not_available"),
    e(3, "+14155552671", "available"),
    e(4, null, "invalid"),
    e(5, "+971501234567", "error"),
    e(6, "+919876543210", "pending"),
    e(7, "+923245237429", "available"),
  ];
  assert.deepEqual(uniqueNumbers(entries, true), ["+923245237429", "+14155552671"]);
  assert.deepEqual(uniqueNumbers(entries, false), ["+923245237429", "+447911123456", "+14155552671", "+971501234567", "+919876543210"]);
  assert.deepEqual(uniqueNumbers([], true), []);
});
