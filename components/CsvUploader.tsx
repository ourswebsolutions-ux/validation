"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Globe, Upload } from "lucide-react";
import { publicConfig } from "@/lib/config";
import type { CsvState } from "@/lib/storage";
import { Button, cn, Spinner } from "./ui";

export function CsvUploader({
  csv,
  onFile,
  onChangeColumn,
  busy,
  disabled,
}: {
  csv: CsvState | null;
  onFile: (file: File) => void;
  onChangeColumn: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Upload CSV file"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) pick(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          dragging ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-slate-50/60 hover:border-brand-300 hover:bg-brand-50/40",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm ring-1 ring-slate-200">
          {busy ? <Spinner className="size-5" /> : <Upload className="size-5" aria-hidden />}
        </span>
        <div>
          <p className="text-sm font-medium text-slate-800">Drop your CSV file here or click to browse</p>
          <p className="mt-1 text-xs text-slate-500">
            .csv up to {Math.round(publicConfig.maxCsvBytes / 1024 / 1024)} MB · up to{" "}
            {publicConfig.maxNumbers.toLocaleString()} rows
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <p className="inline-flex items-start gap-1.5 text-sm text-slate-600">
        <Globe className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
        After upload you choose the phone-number column — only that column is imported. Country is detected
        automatically for every row; numbers need a country code, e.g. +923245237429.
      </p>

      {csv && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          <FileSpreadsheet className="size-4 text-brand-600" aria-hidden />
          <span className="max-w-full truncate font-medium text-slate-800">{csv.fileName}</span>
          <span className="text-slate-400">·</span>
          <span>
            Phone column: <span className="font-medium text-slate-800">{csv.headers[csv.column] ?? "—"}</span>
          </span>
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="sm" onClick={onChangeColumn} disabled={disabled}>
              Change column
            </Button>
            <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
              Replace file
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
