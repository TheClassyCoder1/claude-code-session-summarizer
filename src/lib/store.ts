import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { type ColumnId, COLUMN_IDS } from "./columns";
import type { Card } from "./types";

// Lightweight JSON-file persistence for the MVP.
//
// Why not a database engine? The build environment can't reliably download
// Prisma's query-engine binary through the egress proxy, and Node's built-in
// SQLite still needs an experimental flag on every command. A JSON file has
// zero native dependencies, persists across restarts, and is enough for a
// single-board kanban. All access goes through this module, so swapping in a
// real database later only touches this one file.

export type { Card };

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "board.json");

// In-memory cache, plus a write chain so concurrent mutations don't interleave
// file writes (the Next dev server is a single process).
let cache: Card[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<Card[]> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    cache = JSON.parse(raw) as Card[];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist(cards: Card[]): Promise<void> {
  cache = cards;
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(cards, null, 2), "utf8");
  });
  return writeChain;
}

function now(): string {
  return new Date().toISOString();
}

function sortBoard(cards: Card[]): Card[] {
  const order = (c: ColumnId) => COLUMN_IDS.indexOf(c);
  return [...cards].sort(
    (a, b) => order(a.column) - order(b.column) || a.position - b.position,
  );
}

/** All cards, ordered by column then position. */
export async function listCards(): Promise<Card[]> {
  return sortBoard(await load());
}

/** Append a single card to the end of a column. */
export async function createCard(input: {
  title: string;
  body?: string;
  column: ColumnId;
}): Promise<Card> {
  const cards = await load();
  const maxPos = cards
    .filter((c) => c.column === input.column)
    .reduce((max, c) => Math.max(max, c.position), -1);
  const card: Card = {
    id: randomUUID(),
    title: input.title,
    body: input.body ?? "",
    column: input.column,
    position: maxPos + 1,
    createdAt: now(),
    updatedAt: now(),
  };
  await persist([...cards, card]);
  return card;
}

/** Append several cards to the end of a column (used by the Claude generator). */
export async function createCards(
  items: { title: string; body?: string }[],
  column: ColumnId,
): Promise<Card[]> {
  const cards = await load();
  let pos = cards
    .filter((c) => c.column === column)
    .reduce((max, c) => Math.max(max, c.position), -1);
  const created = items.map((item) => {
    pos += 1;
    return {
      id: randomUUID(),
      title: item.title,
      body: item.body ?? "",
      column,
      position: pos,
      createdAt: now(),
      updatedAt: now(),
    } satisfies Card;
  });
  await persist([...cards, ...created]);
  return created;
}

/** Edit a card's text fields. */
export async function updateCard(
  id: string,
  patch: { title?: string; body?: string },
): Promise<Card | null> {
  const cards = await load();
  const card = cards.find((c) => c.id === id);
  if (!card) return null;
  if (patch.title !== undefined) card.title = patch.title;
  if (patch.body !== undefined) card.body = patch.body;
  card.updatedAt = now();
  await persist(cards);
  return card;
}

/** Move a card to a column at a given index, renumbering that column. */
export async function moveCard(
  id: string,
  toColumn: ColumnId,
  toIndex: number,
): Promise<Card | null> {
  const cards = await load();
  const card = cards.find((c) => c.id === id);
  if (!card) return null;

  card.column = toColumn;
  card.updatedAt = now();

  const targetCards = cards
    .filter((c) => c.column === toColumn && c.id !== id)
    .sort((a, b) => a.position - b.position);

  const index = Math.max(0, Math.min(toIndex, targetCards.length));
  targetCards.splice(index, 0, card);
  targetCards.forEach((c, i) => (c.position = i));

  await persist(cards);
  return card;
}

/** Delete a card. Returns true if it existed. */
export async function deleteCard(id: string): Promise<boolean> {
  const cards = await load();
  const next = cards.filter((c) => c.id !== id);
  if (next.length === cards.length) return false;
  await persist(next);
  return true;
}
