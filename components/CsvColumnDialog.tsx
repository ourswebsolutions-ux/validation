"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, FileSpreadsheet, Info, TriangleAlert, X } from "lucide-react";
import type { PendingCsv } from "@/hooks/useChecker";
import { COUNTRY_CODE_REQUIRED, detectCountry, normalizePhoneNumber } from "@/lib/phone-number";
import { Button, cn } from "./ui";

const PREVIEW_ROWS = 8;

/**
 * Column-selection step for CSV imports: shows what was detected, lets the user pick the
 * phone column, previews ONLY that column, and imports nothing until confirmed.
 */
export function CsvColumnDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingCsv;
  onCancel: () => void;
  onConfirm: (column: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [column, setColumn] = useState<number | null>(pending.initialColumn);
  const { analysis, headers, rows } = pending;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const stats = useMemo(() => {
    if (column === null) return null;
    let found = 0;
    let valid = 0;
    let missingCode = 0;
    const preview: { row: number; value: string }[] = [];
    rows.forEach((r, i) => {
      const value = r[column] ?? "";
      if (!value) return;
      found++;
      if (preview.length < PREVIEW_ROWS) preview.push({ row: i + 1, value });
      const n = normalizePhoneNumber(value);
      if (n.valid) valid++;
      else if (n.reason === COUNTRY_CODE_REQUIRED) missingCode++;
    });
    return { found, valid, missingCode, preview };
  }, [column, rows]);

  const candidates = analysis.columns.filter((c) => c.candidate);
  const detectedName = analysis.selected !== null ? headers[analysis.selected] : null;

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="csv-dialog-title"
      className="m-auto max-h-[92dvh] w-[min(94vw,40rem)] overflow-hidden rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="csv-dialog-title" className="text-lg font-semibold text-slate-900">
              Select phone number column
            </h2>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
              <FileSpreadsheet className="size-4 shrink-0 text-brand-600" aria-hidden />
              <span className="truncate">{pending.fileName}</span>
              <span className="shrink-0">
                · {rows.length.toLocaleString()} rows · {headers.length} column{headers.length === 1 ? "" : "s"}
              </span>
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Cancel import">
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          {analysis.detection === "detected" && (
            <Notice tone="success" Icon={CircleCheck}>
              Phone column detected: <strong className="font-semibold">{detectedName}</strong>
            </Notice>
          )}
          {analysis.detection === "possible" && (
            <Notice tone="info" Icon={Info}>
              Possible phone column detected: <strong className="font-semibold">{detectedName}</strong>. Please confirm it
              below.
            </Notice>
          )}
          {analysis.detection === "multiple" && (
            <Notice tone="warning" Icon={TriangleAlert}>
              Several columns could contain phone numbers ({candidates.map((c) => c.header).join(", ")}). Please select
              the right one.
            </Notice>
          )}
          {analysis.detection === "none" && (
            <Notice tone="warning" Icon={TriangleAlert}>
              <span className="block font-medium">No phone-number column detected.</span>
              Please select the column containing phone numbers.
            </Notice>
          )}

          <div>
            <label htmlFor="csv-column-select" className="mb-1.5 block text-sm font-medium text-slate-700">
              Select the column containing phone numbers
            </label>
            <select
              id="csv-column-select"
              value={column ?? -1}
              onChange={(e) => {
                const v = Number(e.target.value);
                setColumn(v >= 0 ? v : null);
              }}
              className="h-11 w-full rounded-xl border-0 bg-white px-3 text-sm text-slate-900 ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-brand-600 focus:outline-none"
            >
              <option value={-1} disabled>
                Select column
              </option>
              {analysis.columns.map((c) => (
                <option key={c.index} value={c.index}>
                  {c.header}
                  {c.candidate ? " — looks like phone numbers" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-500">
              Only this column is imported. All other columns are ignored.
            </p>
          </div>

          {stats && column !== null && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-slate-600">
                  Selected column: <span className="font-medium text-slate-900">{headers[column]}</span>
                </p>
                <p className="text-sm font-medium text-slate-900 tabular-nums" aria-live="polite">
                  {stats.found.toLocaleString()} number{stats.found === 1 ? "" : "s"} found
                  <span className="font-normal text-slate-500"> · {stats.valid.toLocaleString()} valid</span>
                </p>
              </div>

              {stats.found > 0 && stats.valid === 0 && (
                <Notice tone="warning" Icon={TriangleAlert}>
                  <span className="block font-medium">No valid phone numbers found in this column.</span>
                  {stats.missingCode > 0
                    ? "Numbers need an international country code, e.g. +923245237429."
                    : "Choose another column."}
                </Notice>
              )}
              {stats.found === 0 && (
                <Notice tone="warning" Icon={TriangleAlert}>
                  <span className="block font-medium">No valid phone numbers found in this column.</span>
                  This column is empty.
                </Notice>
              )}

              {stats.preview.length > 0 && (
                <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-medium tracking-wide text-slate-500 uppercase">
                      <tr>
                        <th scope="col" className="w-12 px-3 py-2">#</th>
                        <th scope="col" className="px-3 py-2">Phone Number</th>
                        <th scope="col" className="hidden px-3 py-2 sm:table-cell">Detected</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stats.preview.map(({ row, value }) => {
                        const n = normalizePhoneNumber(value);
                        const c = detectCountry(value);
                        return (
                          <tr key={row}>
                            <td className="px-3 py-2 text-slate-400 tabular-nums">{row}</td>
                            <td className="truncate px-3 py-2 font-medium tabular-nums text-slate-900" title={value}>
                              {value}
                              <span className="block truncate text-xs font-normal text-slate-500 sm:hidden">
                                {n.valid && c ? `${c.flag} ${c.name} (${c.callingCode})` : (n.reason ?? "")}
                              </span>
                            </td>
                            <td
                              className={cn(
                                "hidden truncate px-3 py-2 text-xs sm:table-cell",
                                n.valid ? "text-slate-600" : "text-amber-700",
                              )}
                            >
                              {n.valid && c ? `${c.flag} ${c.name} (${c.callingCode})` : n.reason}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {stats.found > stats.preview.length && (
                    <p className="border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-xs text-slate-500">
                      + {(stats.found - stats.preview.length).toLocaleString()} more
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button variant="secondary" size="lg" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="lg"
            disabled={column === null || !stats || stats.valid === 0}
            onClick={() => column !== null && onConfirm(column)}
          >
            {stats && stats.found > 0
              ? `Import ${stats.found.toLocaleString()} Number${stats.found === 1 ? "" : "s"}`
              : "Import Numbers"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function Notice({
  tone,
  Icon,
  children,
}: {
  tone: "success" | "info" | "warning";
  Icon: typeof Info;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ring-1 ring-inset",
        tone === "success" && "bg-emerald-50 text-emerald-800 ring-emerald-200",
        tone === "info" && "bg-brand-50 text-brand-800 ring-brand-200",
        tone === "warning" && "bg-amber-50 text-amber-800 ring-amber-200",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
