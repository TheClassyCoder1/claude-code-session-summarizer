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
};
