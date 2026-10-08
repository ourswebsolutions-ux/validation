"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, ListPlus, Phone, Play, ShieldCheck, Trash, TriangleAlert } from "lucide-react";
import { toast, Toaster } from "sonner";
import { useChecker } from "@/hooks/useChecker";
import { useConnection } from "@/hooks/useConnection";
import { COUNTRY_CODE_REQUIRED } from "@/lib/phone-number";
import type { Mode } from "@/lib/storage";
import { BulkInput } from "./BulkInput";
import { ConfirmDialog, type ConfirmOptions } from "./ConfirmDialog";
import { ConnectionPanel, ConnectionPill } from "./ConnectionStatus";
import { CsvColumnDialog } from "./CsvColumnDialog";
import { CsvUploader } from "./CsvUploader";
import { ValidSummary } from "./ExportButtons";
import { NumberInput } from "./NumberInput";
import { ProgressPanel } from "./ProgressPanel";
import { ResultsTable } from "./ResultsTable";
import { StatsCards } from "./StatsCards";
import { Button, Card, cn } from "./ui";

const TABS: { key: Mode; label: string; short: string; Icon: typeof Phone }[] = [
  { key: "single", label: "Single Number", short: "Single", Icon: Phone },
  { key: "bulk", label: "Multiple Numbers", short: "Multiple", Icon: ListPlus },
  { key: "csv", label: "Import CSV", short: "Import CSV", Icon: FileSpreadsheet },
];

export function CheckerApp() {
  const conn = useConnection((m) => toast.error(m));
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const connectedRef = useRef(false);
  const autoOpened = useRef(false);

  useEffect(() => {
    connectedRef.current = conn.status?.state === "connected";
  }, [conn.status?.state]);

  // Show the connection panel automatically the first time a QR scan is needed.
  useEffect(() => {
    const s = conn.status?.state;
    if (!autoOpened.current && (s === "qr_required" || s === "disconnected")) {
      autoOpened.current = true;
      setPanelOpen(true);
    }
    if (s === "connected" && autoOpened.current && panelOpen) {
      toast.success("WhatsApp connected.");
      setPanelOpen(false);
    }
  }, [conn.status?.state, panelOpen]);

  const checker = useChecker({
    maxPerRequest: conn.status?.limits.maxNumbersPerRequest ?? 200,
    isConnected: useCallback(() => connectedRef.current, []),
    onNeedConnection: useCallback(() => {
      setPanelOpen(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, []),
  });
  const { data, counts, progress, pendingCsv, busy, isRunning, actions } = checker;
  const { entries, stats } = data.list;
  const runStatus = data.run.status;
  const hasList = entries.length > 0;
  const missingCode = useMemo(() => entries.filter((e) => e.reason === COUNTRY_CODE_REQUIRED).length, [entries]);

  const askStop = () =>
    setConfirm({
      title: "Stop checking?",
      message: "Numbers already checked keep their results. Unchecked numbers stay pending and you can continue later.",
      confirmLabel: "Stop checking",
      tone: "danger",
      onConfirm: actions.stop,
    });

  const askClearSession = () =>
    setConfirm({
      title: "Clear session data?",
      message:
        "This removes all imported numbers, results and settings stored in this browser. Any running check will be stopped.",
      confirmLabel: "Clear data",
      tone: "danger",
      onConfirm: async () => {
        await actions.clearSession();
        toast.success("Session data cleared.");
      },
    });

  const askClearList = () =>
    setConfirm({
      title: "Clear this list?",
      message: "All numbers and their results will be removed from this page.",
      confirmLabel: "Clear list",
      tone: "danger",
      onConfirm: actions.clearList,
    });

  const askLogout = () =>
    setConfirm({
      title: "Unlink WhatsApp device?",
      message: "The server will log out of WhatsApp and delete its session. You’ll need to scan a new QR code to check numbers again.",
      confirmLabel: "Unlink",
      tone: "danger",
      onConfirm: conn.logout,
    });

  return (
    <div className="min-h-dvh bg-[radial-gradient(60rem_30rem_at_50%_-10rem,var(--color-brand-100),transparent)]">
      <Toaster position="top-center" richColors closeButton />
      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
      {pendingCsv && (
        <CsvColumnDialog
          key={`${pendingCsv.fileName}:${pendingCsv.rows.length}:${pendingCsv.initialColumn}`}
          pending={pendingCsv}
          onCancel={actions.cancelCsvImport}
          onConfirm={actions.confirmCsvImport}
        />
      )}

      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/30">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className="text-sm font-semibold tracking-tight text-slate-900 sm:text-base">
            Number<span className="text-brand-600">Check</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionPill conn={conn} expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)} />
          <Button
            variant="ghost"
            size="sm"
            onClick={askClearSession}
            icon={<Trash className="size-4" aria-hidden />}
            aria-label="Clear session data"
          >
            <span className="hidden sm:inline">Clear Session Data</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-6 pb-16 sm:px-6">
        <ConnectionPanel conn={conn} open={panelOpen} onClose={() => setPanelOpen(false)} onLogout={askLogout} />

        <section className="pt-4 text-center sm:pt-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">WhatsApp Number Checker</h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">
            Check WhatsApp availability for single numbers or large lists in seconds.
          </p>
        </section>

        <StatsCards counts={counts} />

        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-2 pt-2 sm:px-4">
            <div role="tablist" aria-label="Checking mode" className="flex gap-1 overflow-x-auto">
              {TABS.map(({ key, label, short, Icon }) => {
                const active = data.mode === key;
                return (
                  <button
                    key={key}
                    id={`tab-${key}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`panel-${key}`}
                    onClick={() => actions.setMode(key)}
                    className={cn(
                      "relative inline-flex h-12 shrink-0 items-center gap-2 px-3 text-sm font-medium transition sm:px-4",
                      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600",
                      active ? "text-brand-700" : "text-slate-500 hover:text-slate-800",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    <span className="sm:hidden">{short}</span>
                    <span className="hidden sm:inline">{label}</span>
                    {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-600" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div id={`panel-${data.mode}`} role="tabpanel" aria-labelledby={`tab-${data.mode}`} className="p-5 sm:p-6">
            {data.mode === "single" && (
              <NumberInput
                value={data.single.input}
                onChange={actions.setSingleInput}
                onCheck={actions.checkSingle}
                loading={busy === "single"}
                result={data.single.result}
              />
            )}
            {data.mode === "bulk" && (
              <BulkInput
                value={data.bulkText}
                onChange={actions.setBulkText}
                onPreview={actions.prepareBulk}
                onCheck={actions.prepareAndStartBulk}
                busy={busy === "prepare"}
                disabled={isRunning}
              />
            )}
            {data.mode === "csv" && (
              <CsvUploader
                csv={data.csv}
                onFile={actions.importCsv}
                onChangeColumn={actions.changeCsvColumn}
                busy={busy === "prepare"}
                disabled={isRunning}
              />
            )}

            {data.mode !== "single" && stats && (
              <div className="mt-6 rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200/70">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                  {[
                    ["Total Numbers", stats.total, "text-slate-900"],
                    ["Valid Format", stats.valid, "text-slate-900"],
                    ["Invalid Format", stats.invalid, "text-amber-700"],
                    ["Duplicates Removed", stats.duplicates, "text-slate-900"],
                    ["Checked", counts.checked, "text-brand-700"],
                    ["WhatsApp Available", counts.available, "text-emerald-700"],
                    ["WhatsApp Not Available", counts.notAvailable, "text-slate-700"],
                    ["Errors", counts.errors, "text-rose-700"],
                  ].map(([label, value, tone]) => (
                    <div key={label as string}>
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className={cn("text-lg font-semibold tabular-nums", tone as string)}>
                        {(value as number).toLocaleString()}
                      </dd>
                    </div>
                  ))}
                </dl>
                {missingCode > 0 && (
                  <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      {missingCode.toLocaleString()} number{missingCode === 1 ? " has" : "s have"} no country code and
                      {missingCode === 1 ? " was" : " were"} marked invalid (country required). Please enter numbers with
                      country code, e.g. <span className="font-medium">+923245237429</span>
                    </span>
                  </p>
                )}
                {runStatus === "idle" && counts.pending > 0 && (
                  <div className="mt-4 flex flex-col gap-3 border-t border-slate-200/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-600">
                      {counts.pending.toLocaleString()} number{counts.pending === 1 ? "" : "s"} ready to check. Review the
                      preview below, then start.
                    </p>
                    <Button size="lg" onClick={actions.start} icon={<Play className="size-4" aria-hidden />}>
                      Start Checking
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {hasList && runStatus !== "idle" && (
          <ProgressPanel
            status={runStatus}
            counts={counts}
            progress={progress}
            onPause={actions.pause}
            onResume={actions.resume}
            onStop={askStop}
            onContinue={actions.start}
            onRetryErrors={actions.retryErrors}
          />
        )}

        {hasList && <ValidSummary entries={entries} available={counts.available} />}

        {hasList && (
          <ResultsTable
            entries={entries}
            title={runStatus === "idle" ? "Preview" : "Results"}
            description={
              runStatus === "idle"
                ? "Numbers are normalized and de-duplicated. Invalid numbers are skipped when checking."
                : data.list.source === "csv" && data.csv
                  ? `From ${data.csv.fileName}`
                  : undefined
            }
            onClear={askClearList}
            clearDisabled={isRunning}
          />
        )}

        <footer className="flex flex-col items-center gap-3 pt-2 text-center text-xs text-slate-500">
          <p>Your temporary checking data is stored locally in this browser and automatically expires.</p>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={data.settings.reuseCache}
              onChange={(e) => actions.setReuseCache(e.target.checked)}
              className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            Reuse results of numbers already checked in this session
          </label>
          <p className="text-slate-400">
            For legitimate contact verification of numbers you are permitted to process. Only registration status is returned.
          </p>
        </footer>
      </main>
    </div>
  );
}
