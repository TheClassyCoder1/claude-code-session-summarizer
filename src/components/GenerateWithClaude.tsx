"use client";

import { useState } from "react";
import type { Card } from "@/lib/types";

type Props = {
  onGenerated: (cards: Card[]) => void;
};

export default function GenerateWithClaude({ onGenerated }: Props) {
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    const trimmed = goal.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Something went wrong.");
        return;
      }
      onGenerated(data.cards as Card[]);
      setGoal("");
    } catch {
      setError("Network error — is the dev server running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <label className="mb-2 block text-sm font-semibold text-slate-700">
        Generate tasks with Claude
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
          }}
          rows={2}
          placeholder="Describe a goal, e.g. “Launch a personal blog” — Claude will break it into task cards."
          className="flex-1 resize-none rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <button
          onClick={generate}
          disabled={loading || !goal.trim()}
          className="shrink-0 self-start rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate tasks"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <p className="mt-2 text-xs text-slate-400">
        New cards are added to “To Do”. Requires ANTHROPIC_API_KEY. (⌘/Ctrl+Enter)
      </p>
    </div>
  );
}
