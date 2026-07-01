"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PendingApproval } from "@/lib/approvals";

export default function PendingApprovalCard({ pending }: { pending: PendingApproval }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "allow" | "deny") => {
    setBusy(true);
    await fetch("/api/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: pending.sessionId, decision }),
    });
    router.refresh();
    setBusy(false);
  };
  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-semibold text-amber-800">
        Waiting for you — approve {pending.tool}?
      </p>
      <pre className="mt-1 overflow-x-auto rounded bg-white/70 p-2 text-xs text-slate-700">
        {pending.input}
      </pre>
      <div className="mt-2 flex gap-2">
        <button
          disabled={busy}
          onClick={() => decide("allow")}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          disabled={busy}
          onClick={() => decide("deny")}
          className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
