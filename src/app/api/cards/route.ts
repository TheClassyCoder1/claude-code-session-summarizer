import { NextResponse } from "next/server";
import { z } from "zod";
import { createCard, listCards } from "@/lib/store";
import { COLUMN_IDS, type ColumnId } from "@/lib/columns";

// JSON file access requires the Node.js runtime (not Edge).
export const runtime = "nodejs";

const createSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  body: z.string().max(2000).optional(),
  column: z.enum(COLUMN_IDS as [ColumnId, ...ColumnId[]]).optional(),
});

export async function GET() {
  const cards = await listCards();
  return NextResponse.json({ cards });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const card = await createCard({
    title: parsed.data.title,
    body: parsed.data.body,
    column: parsed.data.column ?? "todo",
  });
  return NextResponse.json({ card }, { status: 201 });
}
