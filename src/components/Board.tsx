"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { COLUMNS, isColumnId, type ColumnId } from "@/lib/columns";
import type { Card } from "@/lib/types";
import Column from "./Column";
import GenerateWithClaude from "./GenerateWithClaude";
import ImportFromClaudeCode from "./ImportFromClaudeCode";

type Props = { initialCards: Card[] };

// Mirror of store.moveCard so the UI updates optimistically before the request.
function applyMove(
  cards: Card[],
  id: string,
  toColumn: ColumnId,
  toIndex: number,
): Card[] {
  const next = cards.map((c) => ({ ...c }));
  const card = next.find((c) => c.id === id);
  if (!card) return cards;

  card.column = toColumn;
  const target = next
    .filter((c) => c.column === toColumn && c.id !== id)
    .sort((a, b) => a.position - b.position);

  const index = Math.max(0, Math.min(toIndex, target.length));
  target.splice(index, 0, card);
  target.forEach((c, i) => (c.position = i));
  return next;
}

export default function Board({ initialCards }: Props) {
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const cardsByColumn = (column: ColumnId) =>
    cards
      .filter((c) => c.column === column)
      .sort((a, b) => a.position - b.position);

  // Re-sync from the server when an optimistic update can't be confirmed.
  async function resync() {
    try {
      const res = await fetch("/api/cards");
      if (res.ok) {
        const data = await res.json();
        setCards(data.cards as Card[]);
      }
    } catch {
      // leave current state; the next action will retry
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const id = active.id as string;
    const overId = over.id as string;
    const card = cards.find((c) => c.id === id);
    if (!card) return;

    let toColumn: ColumnId;
    let toIndex: number;

    if (isColumnId(overId)) {
      // Dropped on an empty column area → append to that column.
      toColumn = overId;
      toIndex = cardsByColumn(toColumn).filter((c) => c.id !== id).length;
    } else {
      const overCard = cards.find((c) => c.id === overId);
      if (!overCard) return;
      toColumn = overCard.column;
      const colCards = cardsByColumn(toColumn).filter((c) => c.id !== id);
      const overIdx = colCards.findIndex((c) => c.id === overId);
      toIndex = overIdx === -1 ? colCards.length : overIdx;
    }

    const before = cards;
    const moved = applyMove(cards, id, toColumn, toIndex);
    // Skip the request if nothing actually changed.
    if (
      card.column === toColumn &&
      cardsByColumn(toColumn).findIndex((c) => c.id === id) === toIndex
    ) {
      return;
    }
    setCards(moved);

    fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column: toColumn, position: toIndex }),
    })
      .then((res) => {
        if (!res.ok) {
          setCards(before);
          resync();
        }
      })
      .catch(() => {
        setCards(before);
      });
  }

  async function handleAdd(column: ColumnId, title: string) {
    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, column }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setCards((prev) => [...prev, data.card as Card]);
    } catch {
      // ignore; user can retry
    }
  }

  function handleEdit(id: string, patch: { title: string; body: string }) {
    const before = cards;
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
    fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((res) => {
        if (!res.ok) setCards(before);
      })
      .catch(() => setCards(before));
  }

  function handleDelete(id: string) {
    const before = cards;
    setCards((prev) => prev.filter((c) => c.id !== id));
    fetch(`/api/cards/${id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) setCards(before);
      })
      .catch(() => setCards(before));
  }

  function handleGenerated(newCards: Card[]) {
    setCards((prev) => [...prev, ...newCards]);
  }

  function handleImported(newCards: Card[]) {
    setCards((prev) => [...prev, ...newCards]);
  }

  const activeCard = activeId
    ? cards.find((c) => c.id === activeId) ?? null
    : null;

  return (
    <>
      <GenerateWithClaude onGenerated={handleGenerated} />
      <ImportFromClaudeCode onImported={handleImported} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((column) => (
            <Column
              key={column.id}
              column={column}
              cards={cardsByColumn(column.id)}
              onAdd={handleAdd}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard ? (
            <div className="rounded-md border border-slate-300 bg-white p-3 text-sm font-medium shadow-lg">
              {activeCard.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
