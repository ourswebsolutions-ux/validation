"use client";

import { useDeferredValue, useMemo } from "react";
import { Eye, Globe, Play } from "lucide-react";
import { splitNumberList } from "@/lib/phone-number";
import { Button } from "./ui";

const PLACEHOLDER = "+923245237429\n+923001234567\n+14155552671\n+447911123456";

export function BulkInput({
  value,
  onChange,
  onPreview,
  onCheck,
  busy,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onPreview: () => void;
  onCheck: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const deferred = useDeferredValue(value);
  const tokenCount = useMemo(
    () => (deferred.length > 400_000 ? null : splitNumberList(deferred).length),
    [deferred],
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-end justify-between gap-3">
          <label htmlFor="bulk-numbers" className="block text-sm font-medium text-slate-700">
            Phone numbers
          </label>
          <span className="text-xs text-slate-500 tabular-nums">
            {tokenCount === null ? "Large input" : `${tokenCount.toLocaleString()} detected`}
          </span>
        </div>
        <textarea
          id="bulk-numbers"
          rows={8}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby="bulk-hint"
          className="block w-full resize-y rounded-xl border-0 bg-white p-3 font-mono text-sm leading-6 text-slate-900 ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 focus:outline-none disabled:bg-slate-50"
        />
        <p id="bulk-hint" className="mt-1.5 text-xs text-slate-500">
          Separate numbers with new lines, commas, semicolons or spaces. Please enter numbers with country code, e.g.
          +923245237429. Duplicates are removed automatically.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <p className="inline-flex items-center gap-1.5 text-sm text-slate-600">
          <Globe className="size-4 shrink-0 text-brand-600" aria-hidden />
          Country is detected automatically for every number from its country code.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            size="lg"
            onClick={onPreview}
            disabled={disabled || !value.trim()}
            loading={busy}
            icon={<Eye className="size-4" aria-hidden />}
          >
            Preview
          </Button>
          <Button
            size="lg"
            onClick={onCheck}
            disabled={disabled || !value.trim() || busy}
            icon={<Play className="size-4" aria-hidden />}
          >
            Check Numbers
          </Button>
        </div>
      </div>
    </div>
  );
}
