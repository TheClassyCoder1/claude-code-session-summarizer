import { NextResponse } from "next/server";
import { readClaudeCodeWorkItems } from "@/lib/claudeCode";
import { createCards, existingSourceKeys } from "@/lib/store";

// Reads local files (~/.claude) — requires the Node.js runtime.
export const runtime = "nodejs";

export async function POST() {
  let workItems;
  try {
    workItems = await readClaudeCodeWorkItems();
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "Failed to read Claude Code history." },
      { status: 500 },
    );
  }

  if (workItems.length === 0) {
    return NextResponse.json({
      cards: [],
      imported: 0,
      skipped: 0,
      message:
        "No Claude Code history found on this machine (looked in ~/.claude/projects).",
    });
  }

  // Skip work items already imported (dedup by sourceKey).
  const seen = await existingSourceKeys();
  const fresh = workItems.filter((w) => !seen.has(w.sourceKey));
  const skipped = workItems.length - fresh.length;

  // Imported work is already done → land it in the "Done" column.
  const cards = await createCards(fresh, "done");

  return NextResponse.json({
    cards,
    imported: cards.length,
    skipped,
  });
}
