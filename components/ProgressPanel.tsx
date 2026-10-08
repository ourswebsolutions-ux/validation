"use client";

import { Pause, Play, RotateCcw, Square, TriangleAlert, Wifi } from "lucide-react";
import type { Counts, ProgressInfo } from "@/hooks/useChecker";
import type { RunStatus } from "@/lib/storage";
import { Button, Card, cn, Spinner } from "./ui";

function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `~${seconds}s remaining`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `~${m} min ${seconds % 60}s remaining`;
  return `~${Math.floor(m / 60)} h ${m % 60} min remaining`;
}

export function ProgressPanel({
  status,
  counts,
  progress,
  onPause,
  onResume,
  onStop,
  onContinue,
  onRetryErrors,
}: {
  status: RunStatus;
  counts: Counts;
  progress: ProgressInfo;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onContinue: () => void;
  onRetryErrors: () => void;
}) {
  const checkable = counts.valid;
  const done = counts.checked;
  const pct = checkable > 0 ? Math.min(100, Math.round((done / checkable) * 100)) : 0;
  const running = status === "running";
  const paused = status === "paused";
  const waiting = running && progress.jobState === "waiting_connection";
  const eta = running && !waiting ? formatEta(progress.etaSeconds) : null;

  const title = waiting
    ? "Waiting for WhatsApp connection…"
    : running
      ? "Checking numbers…"
      : paused
        ? "Paused"
        : status === "stopped"
          ? "Stopped"
          : "Checking complete";

  return (
    <Card className="p-5 sm:p-6" aria-live="polite">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {running && !waiting && <Spinner className="text-brand-600" />}
          {waiting && <Wifi className="size-4 text-amber-500" aria-hidden />}
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <span className="text-sm text-slate-500 tabular-nums">{pct}%</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {running && (
            <Button variant="secondary" size="sm" onClick={onPause} icon={<Pause className="size-4" aria-hidden />}>
              Pause
            </Button>
          )}
          {paused && (
            <Button size="sm" onClick={onResume} icon={<Play className="size-4" aria-hidden />}>
              Resume
            </Button>
          )}
          {(running || paused) && (
            <Button variant="secondary" size="sm" onClick={onStop} icon={<Square className="size-4 text-rose-600" aria-hidden />}>
              Stop
            </Button>
          )}
          {status === "stopped" && counts.pending > 0 && (
            <Button size="sm" onClick={onContinue} icon={<Play className="size-4" aria-hidden />}>
              Continue checking
            </Button>
          )}
          {!running && !paused && counts.errors > 0 && (
            <Button variant="secondary" size="sm" onClick={onRetryErrors} icon={<RotateCcw className="size-4" aria-hidden />}>
              Retry {counts.errors.toLocaleString()} error{counts.errors === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </div>

      <div
        className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={checkable}
        aria-valuenow={done}
        aria-label="Checking progress"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            paused || waiting ? "bg-amber-400" : status === "stopped" ? "bg-slate-400" : "bg-brand-600",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Checked</dt>
          <dd className="font-semibold tabular-nums text-slate-900">
            {done.toLocaleString()} / {checkable.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Available</dt>
          <dd className="font-semibold tabular-nums text-emerald-700">{counts.available.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Not Available</dt>
          <dd className="font-semibold tabular-nums text-slate-700">{counts.notAvailable.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Errors</dt>
          <dd className="font-semibold tabular-nums text-rose-700">{counts.errors.toLocaleString()}</dd>
        </div>
      </dl>

      {(eta || progress.issue || waiting) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {eta && <span>{eta}</span>}
          {waiting && <span>Checking resumes automatically once WhatsApp reconnects.</span>}
          {progress.issue && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <TriangleAlert className="size-3.5" aria-hidden />
              {progress.issue}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
