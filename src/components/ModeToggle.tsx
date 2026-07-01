"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Mode } from "@/lib/approvals";

// Two-segment switch: CLI vs Dashboard. The active segment is filled; Dashboard
// mode uses amber + a live pulse to signal "approvals are armed here".
export default function ModeToggle({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const set = async (target: Mode) => {
    if (target === mode || busy) return;
    setBusy(true);
    await fetch("/api/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: target }),
    });
    router.refresh();
    setBusy(false);
  };

  const segment = (target: Mode, label: string, activeClass: string) => {
    const active = mode === target;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        disabled={busy}
        onClick={() => set(target)}
        className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
          active ? activeClass : "text-slate-500 hover:bg-slate-100"
        }`}
      >
        {target === "dashboard" && active && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
          </span>
        )}
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div
        role="radiogroup"
        aria-label="Where to answer permission prompts"
        className="inline-flex rounded-md border border-slate-300 bg-white p-0.5"
      >
        {segment("cli", "CLI", "bg-slate-800 text-white")}
        {segment("dashboard", "Dashboard", "bg-amber-500 text-white")}
      </div>
      <p className="text-[10px] text-slate-400">
        {mode === "dashboard" ? "Approve permissions here" : "Approvals in terminal"}
      </p>
    </div>
  );
}
