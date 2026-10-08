"use client";

import { useMemo } from "react";
import { CircleCheck, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { copyText, COPY_FAILED_MESSAGE } from "@/lib/clipboard";
import { downloadCsv, toCsv } from "@/lib/csv";
import { uniqueNumbers, type NumberEntry } from "@/lib/prepare";
import { Button, Card } from "./ui";

export function exportValid(entries: NumberEntry[]) {
  const rows = entries.filter((e) => e.status === "available" && e.normalized).map((e) => [e.normalized!, "available"]);
  if (rows.length === 0) {
    toast.info("There are no WhatsApp-available numbers to export yet.");
    return;
  }
  downloadCsv("whatsapp-valid-numbers.csv", toCsv(["number", "status"], rows));
}

export function exportAll(entries: NumberEntry[]) {
  if (entries.length === 0) {
    toast.info("There are no results to export yet.");
    return;
  }
  const rows = entries.map((e) => [e.normalized ?? e.original, e.status]);
  downloadCsv("whatsapp-check-results.csv", toCsv(["number", "status"], rows));
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

async function copyNumbers(numbers: string[], emptyMessage: string, label: string) {
  if (numbers.length === 0) {
    toast.info(emptyMessage);
    return;
  }
  if (await copyText(numbers.join("\n"))) toast.success(`${plural(numbers.length, label)} copied`);
  else toast.error(COPY_FAILED_MESSAGE);
}

export function ValidSummary({ entries, available }: { entries: NumberEntry[]; available: number }) {
  const validNumbers = useMemo(() => uniqueNumbers(entries, true), [entries]);
  const allNumbers = useMemo(() => uniqueNumbers(entries, false), [entries]);
  return (
    <Card className="relative overflow-hidden p-6">
      <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-emerald-100/60 blur-2xl" aria-hidden />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25">
            <CircleCheck className="size-7" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-500">Valid WhatsApp Numbers</p>
            <p className="text-4xl font-bold tracking-tight tabular-nums text-slate-900" aria-live="polite">
              {available.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-end">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => copyNumbers(validNumbers, "No valid WhatsApp numbers to copy", "valid number")}
            disabled={validNumbers.length === 0}
            icon={<Copy className="size-4 text-emerald-600" aria-hidden />}
          >
            Copy Valid Numbers ({validNumbers.length.toLocaleString()})
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => copyNumbers(allNumbers, "No normalized numbers to copy", "number")}
            disabled={allNumbers.length === 0}
            icon={<Copy className="size-4" aria-hidden />}
          >
            Copy All Numbers ({allNumbers.length.toLocaleString()})
          </Button>
          <Button
            variant="success"
            size="lg"
            onClick={() => exportValid(entries)}
            disabled={available === 0}
            icon={<Download className="size-4" aria-hidden />}
          >
            Export Valid Numbers
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => exportAll(entries)}
            disabled={entries.length === 0}
            icon={<Download className="size-4" aria-hidden />}
          >
            Export All Results
          </Button>
        </div>
      </div>
    </Card>
  );
}
