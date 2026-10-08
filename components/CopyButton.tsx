"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { copyText, COPY_FAILED_MESSAGE } from "@/lib/clipboard";
import { cn } from "./ui";

/** Compact icon button that copies one value and briefly shows a ✓ with "Copied!". */
export function CopyButton({ value, emphasis = false, className }: { value: string; emphasis?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = async () => {
    const ok = await copyText(value);
    if (!ok) {
      toast.error(COPY_FAILED_MESSAGE);
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        onClick={onClick}
        aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
        title={copied ? "Copied!" : "Copy number"}
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg transition",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600",
          copied
            ? "bg-emerald-50 text-emerald-600"
            : emphasis
              ? "text-emerald-600 hover:bg-emerald-50"
              : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
        )}
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
      <span
        role="status"
        className={cn(
          "pointer-events-none absolute left-full ml-1 rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-white transition-opacity",
          copied ? "opacity-100" : "opacity-0",
        )}
      >
        {copied ? "Copied!" : ""}
      </span>
    </span>
  );
}
