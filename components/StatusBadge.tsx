import { Ban, CircleAlert, CircleCheck, CircleX, Clock } from "lucide-react";
import type { CheckStatus } from "@/lib/types";
import { cn } from "./ui";

export const STATUS_META: Record<CheckStatus, { label: string; className: string; Icon: typeof CircleCheck }> = {
  available: { label: "Available", className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", Icon: CircleCheck },
  not_available: { label: "Not Available", className: "bg-slate-100 text-slate-600 ring-slate-500/20", Icon: CircleX },
  invalid: { label: "Invalid", className: "bg-amber-50 text-amber-700 ring-amber-600/20", Icon: Ban },
  error: { label: "Error", className: "bg-rose-50 text-rose-700 ring-rose-600/20", Icon: CircleAlert },
  pending: { label: "Pending", className: "bg-brand-50 text-brand-700 ring-brand-600/20", Icon: Clock },
};

export function StatusBadge({ status, title }: { status: CheckStatus; title?: string }) {
  const { label, className, Icon } = STATUS_META[status];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
