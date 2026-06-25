// The MVP has a single implicit board with three fixed columns.
// Columns live in app code (not the data store) so the UI and API agree on them.

export const COLUMNS = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done" },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];

export const COLUMN_IDS = COLUMNS.map((c) => c.id) as ColumnId[];

export function isColumnId(value: unknown): value is ColumnId {
  return typeof value === "string" && (COLUMN_IDS as string[]).includes(value);
}
