import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteCard, moveCard, updateCard } from "@/lib/store";
import { COLUMN_IDS, type ColumnId } from "@/lib/columns";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(2000).optional(),
    // A move sends the destination column plus the target index within it.
    column: z.enum(COLUMN_IDS as [ColumnId, ...ColumnId[]]).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { title, body, column, position } = parsed.data;
  let card = null;

  // A move (column provided) is applied first, then any text edits.
  if (column !== undefined) {
    card = await moveCard(id, column, position ?? 0);
    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }
  }

  if (title !== undefined || body !== undefined) {
    card = await updateCard(id, { title, body });
    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }
  }

  return NextResponse.json({ card });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const ok = await deleteCard(id);
  if (!ok) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
