"use client";

import { useState } from "react";
import type { Card } from "@/lib/types";

type Props = {
  onImported: (cards: Card[]) => void;
};

export default function ImportFromClaudeCode({ onImported }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importNow() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/import-claude-code", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Import failed.");
        return;
      }
      onImported(data.cards as Card[]);
      if (data.message) {
        setStatus(data.message);
      } else {
        const parts = [`Imported ${data.imported}`];
        if (data.skipped) parts.push(`${data.skipped} already imported`);
        setStatus(`${parts.join(" · ")} → added to “Done”.`);
      }
    } catch {
      setError("Network error — is the dev server running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-700">
            Import from Claude Code
          </p>
          <p className="text-xs text-slate-400">
            Reads your local Claude Code history (~/.claude) and adds what you’ve
            worked on as cards in “Done”. No API key needed.
          </p>
        </div>
        <button
          onClick={importNow}
          disabled={loading}
          className="shrink-0 rounded border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Importing…" : "Import work"}
        </button>
      </div>
      {status && <p className="mt-2 text-xs text-emerald-600">{status}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
