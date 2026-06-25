"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card } from "@/lib/types";

type Props = {
  card: Card;
  onEdit: (id: string, patch: { title: string; body: string }) => void;
  onDelete: (id: string) => void;
};

export default function CardItem({ card, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: editing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle(card.title); // revert empty titles
    } else if (trimmed !== card.title || body !== card.body) {
      onEdit(card.id, { title: trimmed, body });
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="rounded-md border border-slate-300 bg-white p-3 shadow-sm"
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-sm font-medium focus:border-slate-500 focus:outline-none"
          placeholder="Title"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full resize-none rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
          placeholder="Details (optional)"
        />
        <div className="mt-2 flex justify-end gap-2">
          <button
            onClick={() => {
              setTitle(card.title);
              setBody(card.body);
              setEditing(false);
            }}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group cursor-grab rounded-md border border-slate-200 bg-white p-3 shadow-sm hover:border-slate-300 active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{card.title}</p>
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            aria-label="Edit card"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setEditing(true)}
            className="rounded px-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            Edit
          </button>
          <button
            aria-label="Delete card"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onDelete(card.id)}
            className="rounded px-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      </div>
      {card.body && (
        <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">
          {card.body}
        </p>
      )}
    </div>
  );
}
