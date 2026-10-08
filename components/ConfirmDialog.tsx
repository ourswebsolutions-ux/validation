"use client";

import { useEffect, useRef } from "react";
import { Button } from "./ui";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
}

/** Accessible confirmation dialog built on the native <dialog> element. */
export function ConfirmDialog({ options, onClose }: { options: ConfirmOptions | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (options && !dialog.open) dialog.showModal();
    if (!options && dialog.open) dialog.close();
  }, [options]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(92vw,26rem)] rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-[2px]"
    >
      {options && (
        <div className="p-6">
          <h2 id="confirm-title" className="text-lg font-semibold text-slate-900">
            {options.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{options.message}</p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} autoFocus>
              Cancel
            </Button>
            <Button
              variant={options.tone === "danger" ? "danger" : "primary"}
              onClick={async () => {
                onClose();
                await options.onConfirm();
              }}
            >
              {options.confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
