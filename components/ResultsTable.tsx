"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Trash } from "lucide-react";
import { detectCountry } from "@/lib/phone-number";
import type { NumberEntry } from "@/lib/prepare";
import type { CheckStatus } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import { StatusBadge } from "./StatusBadge";
import { Button, Card, cn } from "./ui";

type Filter = "all" | "available" | "not_available" | "invalid" | "error";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "WhatsApp Available" },
  { key: "not_available", label: "Not Available" },
  { key: "invalid", label: "Invalid" },
  { key: "error", label: "Errors" },
];

const PAGE_SIZE = 50;

function formatTime(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
}

export function ResultsTable({
  entries,
  title,
  description,
  onClear,
  clearDisabled,
  footer,
}: {
  entries: NumberEntry[];
  title: string;
  description?: string;
  onClear: () => void;
  clearDisabled: boolean;
  footer?: React.ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(query);

  const tally = useMemo(() => {
    const t: Record<CheckStatus, number> = { available: 0, not_available: 0, invalid: 0, error: 0, pending: 0 };
    for (const e of entries) t[e.status]++;
    return t;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return entries.filter((e) => {
      if (filter !== "all" && e.status !== filter) return false;
      if (!q) return true;
      if (e.original.toLowerCase().includes(q)) return true;
      return qDigits.length > 0 && (e.normalized ?? "").includes(qDigits);
    });
  }, [entries, filter, deferredQuery]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={clearDisabled}
            icon={<Trash className="size-4" aria-hidden />}
            className="self-start"
          >
            Clear list
          </Button>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter results">
            {FILTERS.map(({ key, label }) => {
              const count = key === "all" ? entries.length : tally[key];
              const active = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setFilter(key);
                    setPage(0);
                  }}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                    active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {label}
                  <span className={cn("tabular-nums text-xs", active ? "text-white/80" : "text-slate-400")}>
                    {count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative lg:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search numbers…"
              aria-label="Search numbers"
              className="h-10 w-full rounded-xl border-0 bg-white pr-3 pl-9 text-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 focus:outline-none"
            />
          </div>
        </div>
        {tally.pending > 0 && (
          <p className="text-xs text-slate-500">{tally.pending.toLocaleString()} number(s) pending.</p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <p className="text-sm font-medium text-slate-700">No numbers match this view</p>
          <p className="mt-1 text-sm text-slate-500">Try another filter or clear the search.</p>
        </div>
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium tracking-wide text-slate-500 uppercase">
                <tr>
                  <th scope="col" className="w-16 px-6 py-3">#</th>
                  <th scope="col" className="px-3 py-3">Original Number</th>
                  <th scope="col" className="px-3 py-3">Country</th>
                  <th scope="col" className="px-3 py-3">Code</th>
                  <th scope="col" className="px-3 py-3">Normalized Number</th>
                  <th scope="col" className="px-3 py-3">WhatsApp Status</th>
                  <th scope="col" className="px-6 py-3 text-right">Checked At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((e) => {
                  const c = detectCountry(e.normalized ?? e.original);
                  return (
                  <tr key={e.id} className="hover:bg-slate-50/60">
                    <td className="px-6 py-3 text-slate-400 tabular-nums">{e.id}</td>
                    <td className="max-w-56 truncate px-3 py-3 text-slate-700" title={e.original}>
                      {e.original}
                      {e.row !== undefined && <span className="ml-2 text-xs text-slate-400">row {e.row}</span>}
                    </td>
                    <td className="max-w-44 truncate px-3 py-3 text-slate-700" title={c?.name}>
                      {c ? (
                        <>
                          <span aria-hidden>{c.flag}</span> {c.name}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-600">{c?.callingCode ?? "—"}</td>
                    <td className="px-3 py-3 font-medium tabular-nums text-slate-900">
                      {e.normalized ? (
                        <span className="inline-flex items-center gap-1">
                          {e.normalized}
                          <CopyButton value={e.normalized} emphasis={e.status === "available"} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <StatusBadge status={e.status} title={e.reason} />
                        {e.reason && e.status !== "pending" && <span className="text-xs text-slate-400">{e.reason}</span>}
                        {e.cached && <span className="text-xs text-slate-400">cached</span>}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right whitespace-nowrap text-slate-500 tabular-nums">{formatTime(e.checkedAt)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {rows.map((e) => {
              const c = detectCountry(e.normalized ?? e.original);
              return (
              <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1 font-medium tabular-nums text-slate-900">
                    <span className="truncate">{e.normalized ?? e.original}</span>
                    {e.normalized && <CopyButton value={e.normalized} emphasis={e.status === "available"} />}
                  </p>
                  {c && (
                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      {c.flag} {c.name} · {c.callingCode}
                    </p>
                  )}
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    #{e.id} · {e.original}
                    {e.reason && e.status !== "pending" ? ` · ${e.reason}` : ""}
                  </p>
                  {e.checkedAt && <p className="mt-0.5 text-xs text-slate-400">{formatTime(e.checkedAt)}</p>}
                </div>
                <StatusBadge status={e.status} />
              </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs text-slate-500 tabular-nums">
          {filtered.length === 0
            ? "0 results"
            : `Showing ${(current * PAGE_SIZE + 1).toLocaleString()}–${Math.min(filtered.length, (current + 1) * PAGE_SIZE).toLocaleString()} of ${filtered.length.toLocaleString()}`}
        </p>
        <div className="flex items-center gap-2">
          {footer}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="text-xs text-slate-500 tabular-nums">
            {current + 1} / {pageCount}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(current + 1)}
            disabled={current >= pageCount - 1}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </Card>
  );
}
