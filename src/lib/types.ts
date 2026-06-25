import type { ColumnId } from "./columns";

// Shared Card shape, free of any Node-only imports so client components can use it.
export type Card = {
  id: string;
  title: string;
  body: string;
  column: ColumnId;
  position: number;
  createdAt: string;
  updatedAt: string;
  // Rich fields populated only on Claude-generated cards (optional otherwise).
  details?: string; // detailed description of the task
  devStrategy?: string; // detailed development approach
  iteration?: number; // phase number grouping the work (1, 2, 3…)
  estimatedTokens?: number; // Claude-estimated effort, as a token count
  sourceKey?: string; // stable id for cards imported from Claude Code (dedup)
};
