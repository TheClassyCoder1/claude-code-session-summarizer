# claude-kanban

A minimal full-stack **Kanban board** built with Next.js, with one AI feature:
describe a goal and **Claude** breaks it into task cards for you.

- Three columns: **To Do · In Progress · Done**
- Create, edit, and delete cards
- Drag cards within and across columns (powered by [dnd-kit](https://dndkit.com/))
- **Generate tasks with Claude** — type a high-level goal, get actionable cards in "To Do"
- Persists across restarts (no database setup required)

## Tech stack

- [Next.js 16](https://nextjs.org/) (App Router, TypeScript) — UI + API route handlers
- [Tailwind CSS v4](https://tailwindcss.com/)
- [@dnd-kit](https://dndkit.com/) — accessible drag-and-drop
- [@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk) — Claude (`claude-opus-4-8`, structured output)
- JSON file persistence — see [Data persistence](#data-persistence)

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure your Claude API key (only needed for the "Generate" feature)
cp .env.example .env.local
# then edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...

# 3. Run the dev server
npm run dev
```

Open <http://localhost:3000>.

The board (create / edit / delete / drag) works without any key. The
**Generate tasks with Claude** box needs `ANTHROPIC_API_KEY`; without it the UI
shows a friendly message instead of failing.

## Scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `npm run dev`   | Start the dev server                 |
| `npm run build` | Production build (type-check + lint) |
| `npm run start` | Serve the production build           |
| `npm run lint`  | Run ESLint                           |

## How it works

```
src/
  app/
    page.tsx                 # server component — reads the board, renders <Board>
    layout.tsx
    api/
      cards/route.ts         # GET (list), POST (create)
      cards/[id]/route.ts    # PATCH (edit text / move column+position), DELETE
      generate/route.ts      # POST { goal } -> Claude -> task cards in "To Do"
  components/
    Board.tsx                # DndContext, optimistic state, drag/add/edit/delete handlers
    Column.tsx               # droppable column + "+ Add card"
    CardItem.tsx             # sortable card with inline editing
    GenerateWithClaude.tsx   # goal input -> /api/generate
  lib/
    columns.ts               # the three fixed columns
    types.ts                 # shared Card type (client-safe)
    store.ts                 # JSON-file data access (all persistence lives here)
    anthropic.ts             # Claude client + model id
```

The Claude integration (`src/app/api/generate/route.ts`) calls the Messages API
with **structured outputs** (a JSON schema constraining the response) and
**adaptive thinking**, validates the result with Zod, and persists the cards. It
handles the `refusal` stop reason and missing-key / network errors gracefully.

## Data persistence

The board is stored as JSON at `.data/board.json` (gitignored), created on first
write. This keeps the MVP dependency-free — no database server, no migrations,
no native binaries — while still surviving restarts.

All data access goes through `src/lib/store.ts`, so swapping in a real database
(Prisma/SQLite, Postgres, etc.) later means reimplementing that one module; the
API routes and UI don't change.

To reset the board, delete the file:

```bash
rm -rf .data
```

## Out of scope (MVP)

Multiple boards, labels, due dates, search, authentication, real-time sync, and
streaming the AI response are intentionally left out of this first version.
