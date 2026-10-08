import { CircleCheck, CircleX, ListChecks, Users } from "lucide-react";
import type { Counts } from "@/hooks/useChecker";
import { Card } from "./ui";

export function StatsCards({ counts }: { counts: Counts }) {
  const items = [
    { label: "Total", value: counts.total, Icon: Users, tone: "text-slate-500 bg-slate-100" },
    { label: "Checked", value: counts.checked, Icon: ListChecks, tone: "text-brand-600 bg-brand-50" },
    { label: "WhatsApp Available", value: counts.available, Icon: CircleCheck, tone: "text-emerald-600 bg-emerald-50" },
    { label: "Not Available", value: counts.notAvailable, Icon: CircleX, tone: "text-slate-500 bg-slate-100" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(({ label, value, Icon, tone }) => (
        <Card key={label} className="flex items-center gap-3 p-4">
          <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`}>
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-500">{label}</p>
            <p className="text-xl font-semibold tabular-nums text-slate-900" aria-live="polite">
              {value.toLocaleString()}
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}
