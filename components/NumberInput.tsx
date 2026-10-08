"use client";

import { useMemo } from "react";
import { Globe, Search } from "lucide-react";
import { COUNTRY_CODE_REQUIRED, detectCountry, normalizePhoneNumber } from "@/lib/phone-number";
import type { SingleCheckResponse } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { Button, cn } from "./ui";

export function NumberInput({
  value,
  onChange,
  onCheck,
  loading,
  result,
}: {
  value: string;
  onChange: (v: string) => void;
  onCheck: () => void;
  loading: boolean;
  result: SingleCheckResponse | null;
}) {
  const preview = useMemo(() => (value.trim() ? normalizePhoneNumber(value) : null), [value]);
  const detected = useMemo(() => (preview?.callingCode ? detectCountry(value) : null), [preview, value]);
  const resultCountry = useMemo(
    () => (result ? detectCountry(result.normalizedNumber ?? result.number) : null),
    [result],
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!loading) onCheck();
      }}
    >
      <div>
        <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
          <label htmlFor="single-number" className="block text-sm font-medium text-slate-700">
            Phone number
          </label>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Globe className="size-3.5 text-brand-600" aria-hidden />
            Country is detected automatically from the country code
          </span>
        </div>
        <input
          id="single-number"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={40}
          placeholder="+923245237429"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby="single-number-hint"
          className="h-11 w-full rounded-xl border-0 bg-white px-3 text-sm text-slate-900 ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 focus:outline-none"
        />
        <div id="single-number-hint" aria-live="polite" className="mt-2 min-h-5 text-xs text-slate-500">
          {!preview ? (
            "Enter the number with its country code, e.g. +923245237429. Spaces, dashes and brackets are fine."
          ) : preview.valid ? (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Detected:{" "}
                <span className="font-medium text-slate-800">
                  {detected?.flag} {detected?.name} ({detected?.callingCode})
                </span>
              </span>
              <span>
                Normalized: <span className="font-medium text-slate-800 tabular-nums">{preview.e164}</span>
              </span>
            </span>
          ) : preview.reason === COUNTRY_CODE_REQUIRED ? (
            <span className="text-amber-700">
              ⚠️ Country code required. Example: <span className="font-medium">+923245237429</span>
            </span>
          ) : (
            <span className="text-amber-700">
              ⚠️ Invalid international number
              {detected ? ` for ${detected.name} (${detected.callingCode})` : ""}
              {preview.reason && preview.reason !== "Invalid international number" ? ` · ${preview.reason}` : ""}
            </span>
          )}
        </div>
      </div>

      <Button
        type="submit"
        size="lg"
        loading={loading}
        disabled={!value.trim()}
        icon={<Search className="size-4" aria-hidden />}
        className="w-full sm:w-auto"
      >
        Check Number
      </Button>

      {result && (
        <div
          role="status"
          className={cn(
            "animate-fade-in flex flex-col gap-3 rounded-2xl p-5 ring-1 ring-inset sm:flex-row sm:items-center sm:justify-between",
            result.status === "available" && "bg-emerald-50/70 ring-emerald-200",
            result.status === "not_available" && "bg-slate-50 ring-slate-200",
            result.status === "invalid" && "bg-amber-50/70 ring-amber-200",
            result.status === "error" && "bg-rose-50/70 ring-rose-200",
          )}
        >
          <div>
            <p className="text-lg font-semibold text-slate-900">
              {result.status === "available" && "✅ WhatsApp Available"}
              {result.status === "not_available" && "❌ WhatsApp Not Available"}
              {result.status === "invalid" && "⚠️ Invalid phone number"}
              {result.status === "error" && "⚠️ Could not check this number"}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {result.normalizedNumber ? (
                <>
                  International format:{" "}
                  <span className="font-medium tabular-nums text-slate-900">{result.normalizedNumber}</span>
                </>
              ) : (
                <>Input: {result.number}</>
              )}
              {resultCountry && (
                <span className="block">
                  Country:{" "}
                  <span className="font-medium text-slate-900">
                    {resultCountry.flag} {resultCountry.name} ({resultCountry.callingCode})
                  </span>
                </span>
              )}
              {result.error && (
                <span className="block text-slate-500">
                  {result.error === COUNTRY_CODE_REQUIRED
                    ? "Country required / invalid international number — please enter numbers with country code, e.g. +923245237429"
                    : result.error}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <StatusBadge status={result.status} />
            <span className="text-xs text-slate-500">
              {result.cached ? "From recent check · " : ""}
              {new Date(result.checkedAt).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </form>
  );
}
