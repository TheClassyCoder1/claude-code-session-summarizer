# Dashboard approvals: CLI/Dashboard mode toggle + approve permissions from the UI

Date: 2026-06-30

## Problem

When a Claude Code session is "Waiting for you" (paused on a tool-permission
prompt), the only way to answer is the interactive Y/N prompt in the terminal. We
want to optionally answer it from the dashboard instead — useful when away from the
terminal.

## Constraint that shapes everything

Claude Code's interactive permission prompt only appears **after** a `PreToolUse`
hook returns. The hook is the only thing that can inject a decision programmatically,
and it runs **before** the prompt exists. Therefore:

- You cannot have the terminal prompt and a dashboard control live for the *same*
  prompt simultaneously.
- "Terminal first, then dashboard" is impossible (once the terminal owns the prompt,
  the hook is gone).
- The only workable ordering is **dashboard-window → terminal-fallback**.

A **CLI/Dashboard mode toggle** sidesteps the racing problem: the user picks the
surface. In CLI mode nothing changes; in Dashboard mode gated tools route to the UI.

## Scope (v1)

In scope: a global CLI/Dashboard mode toggle, and Approve/Deny of gated-tool
permission prompts from the dashboard, with timeout fallback to the terminal.

Out of scope (explicitly): sending prompts into a live session from the dashboard
(no hook can inject a user turn), launching new headless `claude -p` runs, and
"remember this approval for the session" (per-call only in v1).

## Decisions

- **Gated tools:** `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit` — the tools
  that actually prompt. Reads stay instant. (A single `GATED_TOOLS` set; adjustable.)
- **Mode default:** `cli` — the feature is inert until the user flips it, so install
  causes zero behavior change.
- **Toggle scope:** global (all sessions on this machine), one flag file.
- **Timeout behavior:** fall back to the terminal prompt (never auto-deny, never hang).
- **Poll window:** `WINDOW_MS = 300_000` (5 min) of polling at `POLL_MS = 1000`. Hook
  `timeout` registered at 600s so the script controls fallback, not Claude.
- **Granularity:** per-call only.

## Architecture

A **new, separate** hook script — `tools/approval-gate/approval-gate.mjs` — kept
apart from `feature-logger.mjs`, whose contract is "never block a turn". The
approval-gate may block (poll) by design, so it must not share a process role with
the logger.

```
Claude Code: tool needs to run
  └─ PreToolUse → approval-gate.mjs   (Claude WAITS for it to exit)
       reads stdin: { session_id, tool_name, tool_input, cwd }
       reads mode.json
       ├─ mode != "dashboard"  OR  tool_name ∉ GATED_TOOLS → exit 0   (instant no-op)
       └─ gated + dashboard mode:
            write  ~/.claude/feature-log/pending/<session_id>.json
                     { sessionId, tool, input, cwd, createdAt }
            loop every POLL_MS up to WINDOW_MS:
               if decisions/<session_id>.json exists:
                 read { decision: "allow"|"deny" }
                 delete pending + decision files
                 print {"hookSpecificOutput":{"hookEventName":"PreToolUse",
                          "permissionDecision":"allow"|"deny",
                          "permissionDecisionReason":"Decided in dashboard"}}
                 exit 0
            window elapsed → delete pending file → exit 0  (terminal prompt appears)
  (any thrown error → exit 0 — fall back to terminal, never auto-deny on a bug)
```

### State (all under `~/.claude/feature-log/`)

| File | Writer | Reader | Shape |
|------|--------|--------|-------|
| `mode.json` | dashboard (`POST /api/mode`) | hook, dashboard RSC | `{ "mode": "cli"\|"dashboard" }` |
| `pending/<sid>.json` | hook | dashboard RSC | `{ sessionId, tool, input, cwd, createdAt }` |
| `decisions/<sid>.json` | dashboard (`POST /api/decision`) | hook | `{ decision: "allow"\|"deny" }` |

One pending per session (Claude blocks one tool at a time per session), so
`session_id` is a sufficient correlation key — no request id needed. Pending records
older than `WINDOW_MS` are treated as stale and ignored by the reader (covers a hook
killed before it could clean up).

### Pure, testable hook helpers (exported from `approval-gate.mjs`)

- `shouldGate(mode: string, tool: string): boolean` — `mode === "dashboard" && GATED_TOOLS.has(tool)`.
- `summarizeInput(tool, toolInput): string` — the human-readable thing being approved
  (`command` for Bash, `file_path` for Write/Edit/MultiEdit/NotebookEdit), redacted
  via the same secret-masking approach as the logger, truncated.
- `decisionOutput(decision: "allow"|"deny"): object` — the `hookSpecificOutput` payload.
- `isStalePending(createdAt: string, now: number, windowMs: number): boolean`.

The blocking poll loop in `main()` is exercised by integration-style tests that write
a decision file mid-wait; the pure helpers carry the unit coverage.

### Dashboard

- **Mode toggle** in the header (`CLI` / `Dashboard`) → `POST /api/mode`, then
  `router.refresh()`. Current mode read server-side and passed down.
- **Pending approvals** read server-side in `page.tsx` (`readPendingApprovals()` in a
  new `src/lib/approvals.ts`), filtered to non-stale, keyed by `sessionId`.
- `FeatureItem` (or a small `PendingApproval` component) shows, for a session with a
  pending record: the tool name, the summarized command/file, and **Approve** / **Deny**
  buttons → `POST /api/decision` → `router.refresh()`.
- The existing 3s `AutoRefresh` poll surfaces new pending records and clears resolved
  ones; no new polling mechanism.

### API routes (Next route handlers, `runtime = "nodejs"`)

- `POST /api/mode` — body `{ mode }`. Validate `mode ∈ {"cli","dashboard"}` (zod).
  Write `mode.json` atomically. 400 on invalid.
- `POST /api/decision` — body `{ sessionId, decision }`. Validate `decision ∈
  {"allow","deny"}` and that `sessionId` is a safe filename (`^[A-Za-z0-9._-]+$`, no
  separators) before composing the path. Write `decisions/<sessionId>.json`
  atomically. 400 on invalid/unsafe input.

Both reuse the atomic-write pattern (`tmp` + rename) already used by the logger.

### Installer

Generalize `tools/feature-logger/install.mjs` to register **two** commands:

- feature-logger → its existing events (`HOOK_EVENTS`).
- approval-gate → `["PreToolUse"]`.

Represent as a list of `{ command, events }`. `pruneStaleHooks` is called per command
with that command's own keep-set, so neither installer prunes the other's hook. The
installer copies both scripts to `~/.claude/`. `npm run hooks` installs/updates both.

## Error handling & safety

- Hook: every path exits 0; any thrown error → exit 0 (terminal fallback). It never
  emits `deny` on its own error — a bug must not silently block tools.
- Default `cli` mode: installing the hook changes nothing until the user opts in.
- API: input validated; `sessionId` path-traversal-guarded; writes confined to the
  decisions/mode files. Dashboard is localhost-only and not to be deployed (existing
  privacy note).
- Approving executes a real tool — the UI always shows the full command/file string
  before the user clicks.
- Stale pending records (> `WINDOW_MS` old) are hidden, so a crashed session doesn't
  leave a dead "Approve" button forever.

## Files

- Create: `tools/approval-gate/approval-gate.mjs`, `tools/approval-gate/approval-gate.test.mjs`
- Create: `src/lib/approvals.ts` (read mode + pending; write helpers shared with routes), `src/lib/approvals.test.ts`
- Create: `src/app/api/mode/route.ts`, `src/app/api/decision/route.ts`
- Create: `src/components/ModeToggle.tsx`, `src/components/PendingApproval.tsx`
- Modify: `src/app/page.tsx` (read mode + pending, pass down)
- Modify: `src/components/FeatureDashboard.tsx` / `FeatureItem.tsx` (render pending approval + toggle)
- Modify: `tools/feature-logger/install.mjs` (+ `install.test.mjs`) — register two commands
- Modify: `README.md`, `tools/feature-logger/README.md` — document mode toggle + approvals

## Testing

- `approval-gate.test.mjs`: `shouldGate` truth table; `summarizeInput` for Bash vs
  file tools + secret redaction; `decisionOutput` shape; `isStalePending`; an
  integration test that runs `main()` against a temp HOME with mode=dashboard, writes
  a decision file mid-poll, and asserts the emitted JSON + cleanup.
- `approvals.test.ts`: read mode default = cli; pending parse + stale filtering.
- API route tests: invalid mode/decision → 400; unsafe `sessionId` rejected; valid
  decision writes the file.
- `install.test.mjs`: both commands registered on their events; prune leaves the other
  command intact.
- Manual: flip to Dashboard mode, trigger a Bash command in a session, approve from the
  dashboard → tool runs; deny → blocked; ignore until timeout → terminal prompt appears.

## Known shortcuts (ponytail)

- **Global toggle**, not per-session. Simplest; per-session needs a session picker.
  Upgrade path: key `mode` by session id.
- **Polling** (1s) over file-watching. Trivial and robust for a local single-user tool.
- **Per-call only.** "Remember for session" deferred; would add an allow-rule store the
  hook consults.
