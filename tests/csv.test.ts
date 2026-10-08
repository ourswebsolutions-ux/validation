import { test } from "node:test";
import assert from "node:assert/strict";
import { CsvError, escapeCsvCell, parseCsvText, toCsv } from "../lib/csv";

const col = (csv: string) => {
  const r = parseCsvText(csv, 1000);
  return { ...r.analysis, name: r.analysis.selected === null ? null : r.headers[r.analysis.selected], r };
};
const only = (csv: string) => {
  const { r, selected } = col(csv);
  return r.rows.map((row) => row[selected!]);
};

test("case 1 — obvious phone column is auto-selected and only it is imported", () => {
  const csv = "name,email,phone,address\nAli,ali@example.com,+923245237429,Vehari\nJohn,john@example.com,+447911123456,London\n";
  const a = col(csv);
  assert.equal(a.detection, "detected");
  assert.equal(a.name, "phone");
  assert.deepEqual(only(csv), ["+923245237429", "+447911123456"]);
});

test("case 2 — different column name (mobile_number)", () => {
  const a = col("name,mobile_number,email\nAli,+923245237429,ali@example.com\nJohn,+447911123456,john@example.com\n");
  assert.equal(a.detection, "detected");
  assert.equal(a.name, "mobile_number");
});

test("case 3 — several possible columns: no guess, user must choose", () => {
  const a = col("name,phone,mobile,city\nAli,+923245237429,+923001234567,Vehari\n");
  assert.equal(a.detection, "multiple");
  assert.equal(a.selected, null);
  assert.deepEqual(a.columns.filter((c) => c.candidate).map((c) => c.header), ["phone", "mobile"]);
});

test("case 4 — no obvious header: detected from values as a possible column", () => {
  const a = col("id,data,location\n1,+923245237429,Vehari\n2,+447911123456,London\n");
  assert.equal(a.detection, "possible");
  assert.equal(a.name, "data");
  const b = col("customer_id,contact_data,city\n1001,+923245237429,Vehari\n1002,+447911123456,London\n");
  assert.equal(b.detection, "possible");
  assert.equal(b.name, "contact_data");
});

test("case 5 — no phone numbers: nothing detected", () => {
  const a = col("name,email,city\nAli,ali@example.com,Vehari\nJohn,john@example.com,London\n");
  assert.equal(a.detection, "none");
  assert.equal(a.selected, null);
});

test("header matching ignores case, spaces, hyphens and camelCase", () => {
  for (const h of ["Phone", "PHONE", "Phone Number", "phone number", "phone-number", "phoneNumber", "Mobile Number", "mobile-number", "mobileNumber", "WhatsApp", "WhatsApp Number", "whatsapp_number", "Contact", "NUMBER"]) {
    const a = col(`name,${h}\nAli,+923245237429\n`);
    assert.equal(a.detection, "detected", h);
    assert.equal(a.name, h, h);
  }
});

test("a phone-named header whose values aren't phone numbers is not trusted blindly", () => {
  const a = col("name,phone,notes\nAli,n/a,+923245237429\nJohn,unknown,+447911123456\n");
  assert.notEqual(a.detection, "detected");
  assert.equal(a.name, "notes");
});

test("single headerless column is used automatically", () => {
  const a = col("+923245237429\n+923001234567\n");
  assert.equal(a.r.hasHeader, false);
  assert.equal(a.detection, "detected");
  assert.equal(a.selected, 0);
});

test("handles BOM, quoted cells and semicolon delimiters", () => {
  const r = parseCsvText('\ufeff"Phone";"Name"\n"+92 324 5237429";"A, B"\n', 1000);
  assert.equal(r.headers[0], "Phone");
  assert.equal(r.rows[0][0], "+92 324 5237429");
  assert.equal(r.rows[0][1], "A, B");
});

test("rejects empty and header-only files", () => {
  assert.throws(() => parseCsvText("", 10), CsvError);
  assert.throws(() => parseCsvText("   \n\n", 10), CsvError);
  assert.throws(() => parseCsvText("phone\n", 10), CsvError);
});

test("limits the number of rows", () => {
  const body = Array.from({ length: 50 }, (_, i) => `+9230012345${String(i).padStart(2, "0")}`).join("\n");
  const r = parseCsvText("phone\n" + body, 20);
  assert.equal(r.rows.length, 20);
  assert.equal(r.truncated, true);
});

test("export escapes formulas but keeps E.164 numbers intact", () => {
  assert.equal(escapeCsvCell("+923245237429"), "+923245237429");
  assert.equal(escapeCsvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(escapeCsvCell('a,"b"'), '"a,""b"""');
  assert.equal(toCsv(["number", "status"], [["+923245237429", "available"]]), "number,status\r\n+923245237429,available\r\n");
});

test("multi-country CSV: number column detected and every row normalized independently", async () => {
  const { prepareNumbers } = await import("../lib/prepare");
  const { detectCountry } = await import("../lib/phone-number");
  const csv = "name,number\nA,+923245237429\nB,+447911123456\nC,+1 (415) 555-2671\nD,+971501234567\nE,+92-324-5237429\nF,03245237429\n";
  const parsed = parseCsvText(csv, 1000);
  const column = parsed.analysis.selected!;
  assert.equal(parsed.headers[column], "number");
  const { entries, stats } = await prepareNumbers(
    parsed.rows.map((r, i) => ({ value: r[column], row: i + 1 })),
    1000,
  );
  assert.deepEqual(stats, { total: 6, valid: 4, invalid: 1, duplicates: 1 });
  assert.deepEqual(
    entries.map((e) => [e.row, detectCountry(e.normalized)?.name ?? null, e.normalized]),
    [
      [1, "Pakistan", "+923245237429"],
      [2, "Guernsey (UK)", "+447911123456"],
      [3, "United States", "+14155552671"],
      [4, "United Arab Emirates", "+971501234567"],
      [6, null, null],
    ],
  );
});
