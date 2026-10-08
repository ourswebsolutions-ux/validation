"use client";

import dynamic from "next/dynamic";

/** The checker relies on browser-only state (LocalStorage), so it renders on the client only. */
const CheckerApp = dynamic(() => import("./CheckerApp").then((m) => m.CheckerApp), {
  ssr: false,
  loading: () => <PageSkeleton />,
});

export function AppShell() {
  return <CheckerApp />;
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse px-4 py-6 sm:px-6" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between">
        <div className="h-9 w-48 rounded-xl bg-slate-200/70" />
        <div className="h-9 w-36 rounded-full bg-slate-200/70" />
      </div>
      <div className="mt-12 h-9 w-80 max-w-full rounded-xl bg-slate-200/70" />
      <div className="mt-3 h-5 w-96 max-w-full rounded-lg bg-slate-200/50" />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[74px] rounded-2xl bg-white shadow-sm" />
        ))}
      </div>
      <div className="mt-6 h-80 rounded-2xl bg-white shadow-sm" />
    </div>
  );
}
