# claude-kanban

A minimal full-stack **Kanban board** built with Next.js, with one AI feature:
describe a goal and **Claude** breaks it into task cards for you.

- Three columns: **To Do · In Progress · Done**
- Create, edit, and delete cards
- Drag cards within and across columns (powered by [dnd-kit](https://dndkit.com/))
- **Generate tasks with Claude** — type a high-level goal, get actionable cards in "To Do".
  Each generated card is rich: a **phase** number, an **estimated effort** (token count),
  a detailed description, and a step-by-step **dev strategy** (shown under "Details")
- **Import from Claude Code** — reconstruct what you've already worked on from your
  local Claude Code history and drop it into "Done" as cards. No API key required
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

Each generated task is returned with `title`, `body` (summary), `details`,
`devStrategy`, `iteration` (phase number), and `estimatedTokens` (Claude's effort
estimate). These rich fields appear only on Claude-generated cards; manually-added
cards stay simple (title + body).

## Import from Claude Code

The **Import from Claude Code** button reconstructs what you've worked on from
Claude Code's local transcripts and adds it to the board — **no API key, fully
offline**.

- Reads `~/.claude/projects/*/*.jsonl` (every Claude Code project on the machine).
- Groups the assistant's file edits and meaningful commands under the human prompt
  that triggered them, producing one card per **work item**.
- Filters out non-human "user" messages (injected skill/tool text and the harness's
  "Continue from where you left off" nudges) so titles reflect what you actually asked.
- Adds cards to **Done** (it's already-completed work) and **dedupes** on re-import
  via a stable `sourceKey`, so clicking it again won't create duplicates.

It reflects history on whatever machine runs the app, so run it locally to see your
real work. Parsing logic lives in `src/lib/claudeCode.ts`.

> Note: transcripts can contain sensitive content — this is a local dev convenience,
> not something to expose on a public deployment.

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
