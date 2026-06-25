"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ColumnId } from "@/lib/columns";
import type { Card } from "@/lib/types";
import CardItem from "./CardItem";

type Props = {
  column: { id: ColumnId; label: string };
  cards: Card[];
  onAdd: (columnId: ColumnId, title: string) => void;
  onEdit: (id: string, patch: { title: string; body: string }) => void;
  onDelete: (id: string) => void;
};

export default function Column({
  column,
  cards,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  function submit() {
    const trimmed = title.trim();
    if (trimmed) onAdd(column.id, trimmed);
    setTitle("");
    setAdding(false);
  }

  return (
    <div className="flex w-full flex-col rounded-lg bg-slate-200/60 p-3">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-700">{column.label}</h2>
        <span className="rounded-full bg-slate-300/70 px-2 text-xs text-slate-600">
          {cards.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-1 flex-col gap-2 rounded-md p-1 transition-colors ${
          isOver ? "bg-slate-300/50" : ""
        }`}
      >
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </SortableContext>

        {cards.length === 0 && !adding && (
          <p className="px-1 py-2 text-xs text-slate-400">No cards yet.</p>
        )}
      </div>

      {adding ? (
        <div className="mt-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setTitle("");
                setAdding(false);
              }
            }}
            placeholder="Card title…"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                setTitle("");
                setAdding(false);
              }}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-300/50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-slate-500 hover:bg-slate-300/50"
        >
          + Add card
        </button>
      )}
    </div>
  );
}
