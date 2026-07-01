# Dashboard Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global CLI/Dashboard mode toggle and let the dashboard Approve/Deny gated-tool permission prompts, with timeout fallback to the terminal.

**Architecture:** A new, separate `PreToolUse` hook (`approval-gate.mjs`) that — only in Dashboard mode, only for gated tools — writes a pending-approval file and polls for a decision the dashboard writes, returning Claude Code's `permissionDecision` JSON. The Next dashboard reads pending files server-side, renders Approve/Deny buttons that POST a decision, and exposes a mode toggle. State is plain JSON files under `~/.claude/feature-log/`.

**Tech Stack:** Node.js (zero-dep hook, `node:test`), Next.js 16 route handlers, TypeScript, Zod, Tailwind.

## Global Constraints

- This is NOT stock Next.js — Route Handlers are `export async function POST(request: Request)` in `src/app/api/<name>/route.ts`, returning `Response.json(...)`. Add `export const runtime = "nodejs"`. Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before writing routes.
- Hook scripts are zero-dependency and exit 0 on every path; **the approval-gate may block (poll) by design, but any error still exits 0** (terminal fallback — never auto-deny on a bug).
- Pure functions are exported from the hook for unit tests; `main()` runs only via the entry guard.
- Before writing new code, run niro `find_reusable_code`. Known reuse: `redactSecrets` from `tools/feature-logger/feature-logger.mjs` (import it; do not duplicate secret patterns).
- Tests run with `npm test` → `node --test "src/**/*.test.ts" "tools/**/*.test.mjs"`.
- State layout under `~/.claude/feature-log/`: `mode.json` = `{"mode":"cli"|"dashboard"}` (default `cli`); `pending/<sessionId>.json` = `{sessionId,tool,input,cwd,createdAt}`; `decisions/<sessionId>.json` = `{"decision":"allow"|"deny"}`.
- `GATED_TOOLS = {Bash, Write, Edit, MultiEdit, NotebookEdit}`. `WINDOW_MS=300000`, `POLL_MS=1000`, both overridable via `APPROVAL_WINDOW_MS` / `APPROVAL_POLL_MS` env (for tests).
- `sessionId` must match `^[A-Za-z0-9._-]+$` before being used in a path (traversal guard).
- `permissionDecision` JSON shape: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"|"deny","permissionDecisionReason":"Decided in dashboard"}}`.

---

### Task 1: approval-gate pure helpers

**Files:**
- Create: `tools/approval-gate/approval-gate.mjs`
- Test: `tools/approval-gate/approval-gate.test.mjs`

**Interfaces:**
- Produces: `GATED_TOOLS: Set<string>`; `shouldGate(mode, tool): boolean`; `summarizeInput(tool, toolInput): string`; `decisionOutput(decision): object`; `isStalePending(createdAt, now, windowMs): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tools/approval-gate/approval-gate.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldGate,
  summarizeInput,
  decisionOutput,
  isStalePending,
} from "./approval-gate.mjs";

test("shouldGate: only in dashboard mode and for gated tools", () => {
  assert.equal(shouldGate("dashboard", "Bash"), true);
  assert.equal(shouldGate("dashboard", "Write"), true);
  assert.equal(shouldGate("dashboard", "Read"), false);
  assert.equal(shouldGate("cli", "Bash"), false);
  assert.equal(shouldGate(undefined, "Bash"), false);
});

test("summarizeInput: command for Bash, file_path for editors, redacted + truncated", () => {
  assert.equal(summarizeInput("Bash", { command: "npm test" }), "npm test");
  assert.equal(summarizeInput("Write", { file_path: "/repo/a.ts" }), "/repo/a.ts");
  assert.equal(summarizeInput("NotebookEdit", { notebook_path: "/n.ipynb" }), "/n.ipynb");
  assert.match(summarizeInput("Bash", { command: "echo sk-ant-abc123XYZ456def789ghi" }), /\[redacted\]/);
  assert.equal(summarizeInput("Bash", { command: "x".repeat(500) }).length, 300);
  assert.equal(summarizeInput("Bash", {}), "");
});

test("decisionOutput: builds the PreToolUse hookSpecificOutput payload", () => {
  assert.deepEqual(decisionOutput("allow"), {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Decided in dashboard",
    },
  });
  assert.equal(decisionOutput("deny").hookSpecificOutput.permissionDecision, "deny");
});

test("isStalePending: true once older than the window", () => {
  const now = 1_000_000;
  assert.equal(isStalePending(new Date(now - 10_000).toISOString(), now, 300_000), false);
  assert.equal(isStalePending(new Date(now - 400_000).toISOString(), now, 300_000), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/approval-gate/approval-gate.test.mjs`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write the helpers**

Create `tools/approval-gate/approval-gate.mjs`:

```js
#!/usr/bin/env node
// Claude Code PreToolUse hook — routes gated-tool permission prompts to the
// dashboard when in "dashboard" mode. Separate from feature-logger because this
// one BLOCKS (polls) by design. Every path still exits 0; on timeout or any error
// it emits no decision, so Claude falls back to the normal terminal prompt.

import fs from "fs";
import path from "path";
import os from "os";
import { pathToFileURL } from "url";
import { redactSecrets } from "../feature-logger/feature-logger.mjs";

export const GATED_TOOLS = new Set(["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"]);

const BASE = path.join(os.homedir(), ".claude", "feature-log");
const MODE_FILE = path.join(BASE, "mode.json");
const PENDING_DIR = path.join(BASE, "pending");
const DECISIONS_DIR = path.join(BASE, "decisions");
const WINDOW_MS = Number(process.env.APPROVAL_WINDOW_MS) || 300_000;
const POLL_MS = Number(process.env.APPROVAL_POLL_MS) || 1000;

export function shouldGate(mode, tool) {
  return mode === "dashboard" && GATED_TOOLS.has(tool);
}

export function summarizeInput(tool, toolInput) {
  const raw =
    tool === "Bash" ? toolInput?.command : toolInput?.file_path || toolInput?.notebook_path;
  if (typeof raw !== "string") return "";
  return redactSecrets(raw).slice(0, 300);
}

export function decisionOutput(decision) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: "Decided in dashboard",
    },
  };
}

export function isStalePending(createdAt, now, windowMs) {
  const t = Date.parse(createdAt);
  return Number.isNaN(t) || now - t > windowMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/approval-gate/approval-gate.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/approval-gate/approval-gate.mjs tools/approval-gate/approval-gate.test.mjs
git commit -m "feat: approval-gate hook helpers"
```

---

### Task 2: approval-gate main() blocking poll + integration test

**Files:**
- Modify: `tools/approval-gate/approval-gate.mjs`
- Test: `tools/approval-gate/approval-gate.test.mjs`

**Interfaces:**
- Consumes: Task 1 helpers + module constants.
- Produces: a runnable hook. When invoked with mode=dashboard and a gated tool, writes `pending/<sid>.json`, polls `decisions/<sid>.json`, prints `decisionOutput(...)` JSON to stdout and cleans up, or exits silently after `WINDOW_MS`.

- [ ] **Step 1: Write the failing integration test**

Append to `tools/approval-gate/approval-gate.test.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "approval-gate.mjs");

function runHook(home, event, env = {}) {
  const child = spawn(process.execPath, [SCRIPT], {
    env: { ...process.env, HOME: home, APPROVAL_POLL_MS: "50", APPROVAL_WINDOW_MS: "3000", ...env },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stdin.end(JSON.stringify(event));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, out })));
}

test("main: dashboard mode + gated tool waits for a decision, emits allow, cleans up", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "appgate-"));
  const base = path.join(home, ".claude", "feature-log");
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, "mode.json"), JSON.stringify({ mode: "dashboard" }));
  const sid = "sess-1";

  const p = runHook(home, {
    session_id: sid,
    tool_name: "Bash",
    tool_input: { command: "rm -rf build" },
    cwd: "/repo",
  });

  // Pending appears, then we approve mid-poll.
  await new Promise((r) => setTimeout(r, 150));
  const pendingFile = path.join(base, "pending", `${sid}.json`);
  assert.ok(fs.existsSync(pendingFile), "pending written");
  const pending = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
  assert.equal(pending.tool, "Bash");
  assert.equal(pending.input, "rm -rf build");
  fs.mkdirSync(path.join(base, "decisions"), { recursive: true });
  fs.writeFileSync(path.join(base, "decisions", `${sid}.json`), JSON.stringify({ decision: "allow" }));

  const { code, out } = await p;
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(fs.existsSync(pendingFile), false, "pending cleaned up");
  assert.equal(fs.existsSync(path.join(base, "decisions", `${sid}.json`)), false, "decision cleaned up");
});

test("main: cli mode is an instant no-op (no pending, no output)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "appgate-"));
  fs.mkdirSync(path.join(home, ".claude", "feature-log"), { recursive: true });
  // no mode.json → defaults to cli
  const { code, out } = await runHook(home, {
    session_id: "s2",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    cwd: "/repo",
  });
  assert.equal(code, 0);
  assert.equal(out.trim(), "");
});
```

Add `import os from "node:os";` to the test file's imports if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/approval-gate/approval-gate.test.mjs`
Expected: FAIL — no `main()`/entry guard yet; cli-mode test may pass but the dashboard test fails (no pending written, no output).

- [ ] **Step 3: Implement main() + entry guard**

Append to `tools/approval-gate/approval-gate.mjs`:

```js
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function readMode() {
  try {
    return JSON.parse(fs.readFileSync(MODE_FILE, "utf8")).mode || "cli";
  } catch {
    return "cli";
  }
}

function writeAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function rm(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (process.env.FEATURE_LOGGER_ACTIVE === "1") return; // don't gate our own summarizer
  let input;
  try {
    input = JSON.parse(readStdin() || "{}");
  } catch {
    return;
  }
  const sid = input.session_id;
  const tool = input.tool_name;
  if (!sid || !shouldGate(readMode(), tool)) return;

  const pendingFile = path.join(PENDING_DIR, `${sid}.json`);
  const decisionFile = path.join(DECISIONS_DIR, `${sid}.json`);
  writeAtomic(pendingFile, {
    sessionId: sid,
    tool,
    input: summarizeInput(tool, input.tool_input),
    cwd: input.cwd || "",
    createdAt: new Date().toISOString(),
  });

  const deadline = Date.now() + WINDOW_MS;
  try {
    while (Date.now() < deadline) {
      let decision;
      try {
        decision = JSON.parse(fs.readFileSync(decisionFile, "utf8")).decision;
      } catch {
        decision = null;
      }
      if (decision === "allow" || decision === "deny") {
        rm(decisionFile);
        process.stdout.write(JSON.stringify(decisionOutput(decision)));
        return;
      }
      await sleep(POLL_MS);
    }
  } finally {
    rm(pendingFile); // window elapsed or decided → no dangling pending
  }
  // no decision within the window → no output → terminal prompt appears
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then(
    () => process.exit(0),
    () => process.exit(0),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/approval-gate/approval-gate.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/approval-gate/approval-gate.mjs tools/approval-gate/approval-gate.test.mjs
git commit -m "feat: approval-gate polls dashboard for permission decisions"
```

---

### Task 3: `approvals.ts` — read mode/pending, write helpers

**Files:**
- Create: `src/lib/approvals.ts`
- Test: `src/lib/approvals.test.ts`

**Interfaces:**
- Produces:
  - `type Mode = "cli" | "dashboard"`
  - `type PendingApproval = { sessionId: string; tool: string; input: string; cwd: string; createdAt: string }`
  - `isSafeSessionId(s: string): boolean`
  - `readMode(): Promise<Mode>` (default `"cli"`)
  - `readPendingApprovals(now?: number): Promise<PendingApproval[]>` (drops stale > 300000ms)
  - `writeMode(mode: unknown): Promise<Mode>` (validates; throws on bad)
  - `writeDecision(sessionId: unknown, decision: unknown): Promise<void>` (validates id + decision; throws on bad)

- [ ] **Step 1: Write the failing test**

Create `src/lib/approvals.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isSafeSessionId,
  readMode,
  writeMode,
  writeDecision,
  readPendingApprovals,
} from "./approvals.ts";

async function tmpHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "approvals-"));
  process.env.HOME = home;
  await fs.mkdir(path.join(home, ".claude", "feature-log"), { recursive: true });
  return home;
}

test("isSafeSessionId rejects path separators and traversal", () => {
  assert.equal(isSafeSessionId("abc-123_4.json"), true);
  assert.equal(isSafeSessionId("../etc/passwd"), false);
  assert.equal(isSafeSessionId("a/b"), false);
  assert.equal(isSafeSessionId(""), false);
});

test("readMode defaults to cli, reflects writeMode", async () => {
  await tmpHome();
  assert.equal(await readMode(), "cli");
  assert.equal(await writeMode("dashboard"), "dashboard");
  assert.equal(await readMode(), "dashboard");
});

test("writeMode rejects bad values", async () => {
  await tmpHome();
  await assert.rejects(() => writeMode("nope"));
});

test("writeDecision validates id + decision and writes the file", async () => {
  const home = await tmpHome();
  await writeDecision("sess-1", "allow");
  const f = path.join(home, ".claude", "feature-log", "decisions", "sess-1.json");
  assert.equal(JSON.parse(await fs.readFile(f, "utf8")).decision, "allow");
  await assert.rejects(() => writeDecision("../x", "allow"));
  await assert.rejects(() => writeDecision("sess-1", "maybe"));
});

test("readPendingApprovals returns fresh, drops stale", async () => {
  const home = await tmpHome();
  const dir = path.join(home, ".claude", "feature-log", "pending");
  await fs.mkdir(dir, { recursive: true });
  const now = Date.now();
  await fs.writeFile(
    path.join(dir, "fresh.json"),
    JSON.stringify({ sessionId: "fresh", tool: "Bash", input: "ls", cwd: "/r", createdAt: new Date(now).toISOString() }),
  );
  await fs.writeFile(
    path.join(dir, "stale.json"),
    JSON.stringify({ sessionId: "stale", tool: "Bash", input: "ls", cwd: "/r", createdAt: new Date(now - 400_000).toISOString() }),
  );
  const pending = await readPendingApprovals(now);
  assert.deepEqual(pending.map((p) => p.sessionId), ["fresh"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/approvals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/approvals.ts`**

```ts
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { z } from "zod";

export type Mode = "cli" | "dashboard";
export type PendingApproval = {
  sessionId: string;
  tool: string;
  input: string;
  cwd: string;
  createdAt: string;
};

const WINDOW_MS = 300_000;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

// Recomputed per call so tests can repoint HOME between cases.
const base = () => path.join(os.homedir(), ".claude", "feature-log");
const modeFile = () => path.join(base(), "mode.json");
const decisionsDir = () => path.join(base(), "pending", "..", "decisions");
const pendingDir = () => path.join(base(), "pending");

export function isSafeSessionId(s: string): boolean {
  return typeof s === "string" && s.length > 0 && SAFE_ID.test(s);
}

async function writeAtomic(file: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fs.rename(tmp, file);
}

export async function readMode(): Promise<Mode> {
  try {
    const m = JSON.parse(await fs.readFile(modeFile(), "utf8")).mode;
    return m === "dashboard" ? "dashboard" : "cli";
  } catch {
    return "cli";
  }
}

export async function writeMode(mode: unknown): Promise<Mode> {
  const parsed = z.enum(["cli", "dashboard"]).parse(mode);
  await writeAtomic(modeFile(), { mode: parsed });
  return parsed;
}

export async function writeDecision(sessionId: unknown, decision: unknown): Promise<void> {
  if (typeof sessionId !== "string" || !isSafeSessionId(sessionId)) {
    throw new Error("invalid sessionId");
  }
  const d = z.enum(["allow", "deny"]).parse(decision);
  await writeAtomic(path.join(decisionsDir(), `${sessionId}.json`), { decision: d });
}

const pendingSchema = z.object({
  sessionId: z.string(),
  tool: z.string(),
  input: z.string(),
  cwd: z.string(),
  createdAt: z.string(),
});

export async function readPendingApprovals(now: number = Date.now()): Promise<PendingApproval[]> {
  let files: string[];
  try {
    files = await fs.readdir(pendingDir());
  } catch {
    return [];
  }
  const out: PendingApproval[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = pendingSchema.parse(JSON.parse(await fs.readFile(path.join(pendingDir(), f), "utf8")));
      if (now - Date.parse(p.createdAt) <= WINDOW_MS) out.push(p);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}
```

Note: `decisionsDir()` is written `pending/../decisions` deliberately so the path constant stays in one place; it resolves to `<base>/decisions`. (Or write it directly as `path.join(base(), "decisions")` — pick one and keep it.) Use `path.join(base(), "decisions")` for clarity:

```ts
const decisionsDir = () => path.join(base(), "decisions");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/approvals.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/approvals.ts src/lib/approvals.test.ts
git commit -m "feat: approvals lib (mode + pending read/write)"
```

---

### Task 4: API routes `/api/mode` and `/api/decision`

**Files:**
- Create: `src/app/api/mode/route.ts`
- Create: `src/app/api/decision/route.ts`
- Test: `src/app/api/api.test.ts`

**Interfaces:**
- Consumes: `writeMode`, `writeDecision` from `src/lib/approvals.ts`.
- Produces: `POST /api/mode` ({mode}) and `POST /api/decision` ({sessionId, decision}); 200 `{ok:true,...}` on success, 400 on invalid input.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/api.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST as modePOST } from "./mode/route.ts";
import { POST as decisionPOST } from "./decision/route.ts";

async function tmpHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "api-"));
  process.env.HOME = home;
  return home;
}
const req = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });

test("POST /api/mode sets the mode", async () => {
  const home = await tmpHome();
  const res = await modePOST(req({ mode: "dashboard" }));
  assert.equal(res.status, 200);
  const f = path.join(home, ".claude", "feature-log", "mode.json");
  assert.equal(JSON.parse(await fs.readFile(f, "utf8")).mode, "dashboard");
});

test("POST /api/mode rejects bad mode with 400", async () => {
  await tmpHome();
  assert.equal((await modePOST(req({ mode: "x" }))).status, 400);
});

test("POST /api/decision writes a decision", async () => {
  const home = await tmpHome();
  const res = await decisionPOST(req({ sessionId: "s1", decision: "deny" }));
  assert.equal(res.status, 200);
  const f = path.join(home, ".claude", "feature-log", "decisions", "s1.json");
  assert.equal(JSON.parse(await fs.readFile(f, "utf8")).decision, "deny");
});

test("POST /api/decision rejects unsafe sessionId and bad decision with 400", async () => {
  await tmpHome();
  assert.equal((await decisionPOST(req({ sessionId: "../x", decision: "allow" }))).status, 400);
  assert.equal((await decisionPOST(req({ sessionId: "s1", decision: "maybe" }))).status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/app/api/api.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement the routes**

`src/app/api/mode/route.ts`:

```ts
import { writeMode } from "@/lib/approvals";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { mode } = await request.json();
    const set = await writeMode(mode);
    return Response.json({ ok: true, mode: set });
  } catch {
    return Response.json({ ok: false, error: "invalid mode" }, { status: 400 });
  }
}
```

`src/app/api/decision/route.ts`:

```ts
import { writeDecision } from "@/lib/approvals";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { sessionId, decision } = await request.json();
    await writeDecision(sessionId, decision);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/app/api/api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mode/route.ts src/app/api/decision/route.ts src/app/api/api.test.ts
git commit -m "feat: /api/mode and /api/decision route handlers"
```

---

### Task 5: Dashboard UI — mode toggle + pending approval cards

**Files:**
- Create: `src/components/ModeToggle.tsx`
- Create: `src/components/PendingApproval.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/FeatureDashboard.tsx`

**Interfaces:**
- Consumes: `readMode`, `readPendingApprovals`, `PendingApproval` from `src/lib/approvals.ts`; `POST /api/mode`, `POST /api/decision`.
- Produces: header toggle; per-session Approve/Deny cards keyed by `sessionId`.

- [ ] **Step 1: Create `ModeToggle.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Mode } from "@/lib/approvals";

export default function ModeToggle({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next: Mode = mode === "dashboard" ? "cli" : "dashboard";
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/mode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: next }),
        });
        router.refresh();
        setBusy(false);
      }}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        mode === "dashboard" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"
      }`}
      title="Toggle whether permission prompts are answered here or in the terminal"
    >
      {mode === "dashboard" ? "Dashboard mode" : "CLI mode"}
    </button>
  );
}
```

- [ ] **Step 2: Create `PendingApproval.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PendingApproval } from "@/lib/approvals";

export default function PendingApprovalCard({ pending }: { pending: PendingApproval }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "allow" | "deny") => {
    setBusy(true);
    await fetch("/api/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: pending.sessionId, decision }),
    });
    router.refresh();
    setBusy(false);
  };
  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-semibold text-amber-800">Waiting for you — approve {pending.tool}?</p>
      <pre className="mt-1 overflow-x-auto rounded bg-white/70 p-2 text-xs text-slate-700">{pending.input}</pre>
      <div className="mt-2 flex gap-2">
        <button
          disabled={busy}
          onClick={() => decide("allow")}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          disabled={busy}
          onClick={() => decide("deny")}
          className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `page.tsx`**

Modify `src/app/page.tsx` — read mode + pending and pass to the dashboard:

```tsx
import FeatureDashboard from "@/components/FeatureDashboard";
import AutoRefresh from "@/components/AutoRefresh";
import TabBadge from "@/components/TabBadge";
import { readFeatureRecords } from "@/lib/featureLog";
import { deriveStatus } from "@/lib/featureTypes";
import { readMode, readPendingApprovals } from "@/lib/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const [records, mode, pending] = await Promise.all([
    readFeatureRecords(),
    readMode(),
    readPendingApprovals(),
  ]);
  const pendingBySession = Object.fromEntries(pending.map((p) => [p.sessionId, p]));
  const attention =
    pending.length +
    records.filter((r) => {
      const s = deriveStatus(r);
      return s === "awaiting_approval" || s === "idle";
    }).length;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Claude Session Dashboard</h1>
            <p className="text-sm text-slate-500">
              What you built with Claude Code — per session, with token usage and cost.
            </p>
          </div>
          <ModeToggle mode={mode} />
        </header>
        <FeatureDashboard records={records} pendingBySession={pendingBySession} />
      </div>
      <AutoRefresh />
      <TabBadge count={attention} />
    </main>
  );
}
```

Add the import at the top: `import ModeToggle from "@/components/ModeToggle";`

- [ ] **Step 4: Thread `pendingBySession` to the item and render the card**

In `src/components/FeatureDashboard.tsx`: add `pendingBySession` to the component props (`Record<string, PendingApproval>`, default `{}`), and where each `FeatureItem`/card renders, render `<PendingApprovalCard pending={pendingBySession[r.sessionId]} />` when `pendingBySession[r.sessionId]` exists. Import `PendingApprovalCard` and the `PendingApproval` type. Pass `pendingBySession` down through `StatusSections`/group views so every place a record card renders can show its pending card.

(Exact wiring depends on the current JSX; the rule: for every rendered record `r`, conditionally render the pending card beneath it using `pendingBySession[r.sessionId]`.)

- [ ] **Step 5: Build to verify**

Run: `npm run build`
Expected: compiles, type-checks, lints clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ModeToggle.tsx src/components/PendingApproval.tsx src/app/page.tsx src/components/FeatureDashboard.tsx
git commit -m "feat: mode toggle + pending-approval cards in the dashboard"
```

---

### Task 6: Installer registers both hook scripts

**Files:**
- Modify: `tools/feature-logger/install.mjs`
- Modify: `tools/feature-logger/install.test.mjs`

**Interfaces:**
- Consumes: existing `HOOK_EVENTS`, `pruneStaleHooks`.
- Produces: exported `INSTALLS: Array<{ command: string; events: string[] }>`; installer copies both scripts and registers/prunes each command against its own events.

- [ ] **Step 1: Write the failing test**

Add to `tools/feature-logger/install.test.mjs`:

```js
import { HOOK_EVENTS, pruneStaleHooks, INSTALLS } from "./install.mjs";

test("INSTALLS registers feature-logger on its events and approval-gate on PreToolUse", () => {
  const fl = INSTALLS.find((i) => i.command.includes("feature-logger"));
  const ag = INSTALLS.find((i) => i.command.includes("approval-gate"));
  assert.deepEqual([...fl.events].sort(), [...HOOK_EVENTS].sort());
  assert.deepEqual(ag.events, ["PreToolUse"]);
});

test("pruning per-command leaves the other command's hook intact", () => {
  const FL = "~/.claude/feature-logger/feature-logger.mjs";
  const AG = "~/.claude/approval-gate/approval-gate.mjs";
  const hooks = {
    PreToolUse: [
      { matcher: "", hooks: [{ type: "command", command: AG }] },
      { matcher: "", hooks: [{ type: "command", command: FL }] }, // stale FL on PreToolUse
    ],
  };
  // FL keeps HOOK_EVENTS (no PreToolUse) → its PreToolUse entry is pruned; AG kept.
  const pruned = pruneStaleHooks(hooks, FL, HOOK_EVENTS);
  assert.deepEqual(pruned, ["PreToolUse"]);
  assert.equal(hooks.PreToolUse.length, 1);
  assert.equal(hooks.PreToolUse[0].hooks[0].command, AG);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/feature-logger/install.test.mjs`
Expected: FAIL — `INSTALLS` not exported.

- [ ] **Step 3: Generalize the installer**

In `tools/feature-logger/install.mjs`:

Add after `HOOK_EVENTS`:

```js
const AG_COMMAND = "~/.claude/approval-gate/approval-gate.mjs";

export const INSTALLS = [
  { command: HOOK_COMMAND, events: HOOK_EVENTS, src: "feature-logger/feature-logger.mjs", dest: destScript },
  {
    command: AG_COMMAND,
    events: ["PreToolUse"],
    src: "approval-gate/approval-gate.mjs",
    dest: path.join(claudeDir, "approval-gate", "approval-gate.mjs"),
  },
];
```

`src` is resolved relative to the repo `tools/` dir. Compute the repo tools dir once: `const toolsDir = path.resolve(here, "..");` (since `here` is `tools/feature-logger`). Then copy each:

```js
  // 1. Copy each script.
  for (const inst of INSTALLS) {
    fs.mkdirSync(path.dirname(inst.dest), { recursive: true });
    fs.copyFileSync(path.join(toolsDir, inst.src), inst.dest);
    try {
      fs.chmodSync(inst.dest, 0o755);
    } catch {
      /* best effort */
    }
    log(`✓ Installed script → ${inst.dest}`);
  }
```

Replace the single-command merge/prune loop (step 3 + 3b) with a per-install loop:

```js
  // 3. Merge + prune each command against its own event set.
  settings.hooks = settings.hooks || {};
  let changed = false;
  for (const inst of INSTALLS) {
    for (const event of inst.events) {
      settings.hooks[event] = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
      if (hasOurHook(settings.hooks[event], inst.command)) {
        log(`• ${event}: ${inst.command} already present — skipping`);
      } else {
        settings.hooks[event].push(hookEntry(inst.command));
        changed = true;
        log(`✓ ${event}: added ${inst.command}`);
      }
    }
    for (const event of pruneStaleHooks(settings.hooks, inst.command, inst.events)) {
      changed = true;
      log(`✓ ${event}: removed stale ${inst.command}`);
    }
  }
```

Update `hookEntry` and `hasOurHook` to take the command as a parameter:

```js
function hookEntry(command) {
  return { matcher: "", hooks: [{ type: "command", command, timeout: 60 }] };
}

function hasOurHook(arr, command) {
  return (
    Array.isArray(arr) &&
    arr.some((e) => Array.isArray(e?.hooks) && e.hooks.some((h) => h?.command === command))
  );
}
```

(`HOOK_COMMAND` and `destScript` already exist; keep them.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/feature-logger/install.test.mjs`
Expected: PASS (all install tests).

- [ ] **Step 5: Commit**

```bash
git add tools/feature-logger/install.mjs tools/feature-logger/install.test.mjs
git commit -m "feat: installer registers the approval-gate PreToolUse hook"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`
- Modify: `tools/feature-logger/README.md`

- [ ] **Step 1: Document in the root README**

Under "How it works" / setup, add a short section:

```markdown
### Approving permissions from the dashboard

Toggle the header **CLI mode / Dashboard mode** button. In **Dashboard mode**, when a
session needs permission to run a gated tool (`Bash`, `Write`, `Edit`, `MultiEdit`,
`NotebookEdit`), the dashboard shows the command/file with **Approve** / **Deny**
buttons. If you don't answer within ~5 minutes, it falls back to the normal terminal
prompt. **CLI mode** (the default) changes nothing — answer in the terminal as usual.

This is powered by a second hook, `tools/approval-gate/approval-gate.mjs`, installed
alongside the logger by `npm run hooks`.
```

Add to the project-layout block:

```
tools/approval-gate/
  approval-gate.mjs    # PreToolUse hook — routes gated approvals to the dashboard
```

- [ ] **Step 2: Note it in the feature-logger README**

Add a line noting the installer also registers `approval-gate.mjs` on `PreToolUse`, and that it only acts in Dashboard mode (the `mode.json` flag), defaulting to CLI (no-op).

- [ ] **Step 3: Commit**

```bash
git add README.md tools/feature-logger/README.md
git commit -m "docs: document dashboard approvals + mode toggle"
```

---

### Task 8: Reinstall + manual end-to-end verification

**Files:** none (operational).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 2: Reinstall both hooks**

Run: `npm run hooks`
Expected: logs show `approval-gate.mjs` added on `PreToolUse`; feature-logger events already present.

- [ ] **Step 3: Manual e2e in a NEW Claude Code session**

- Start the dashboard: `npm run dev`.
- Click the header toggle → **Dashboard mode**.
- In a new Claude Code session, ask it to run a Bash command. Within ~3s the session's card shows **Approve / Deny** with the command.
- Click **Approve** → the command runs. Repeat, click **Deny** → Claude is told it was blocked.
- Trigger another, ignore the dashboard for >5 min → the normal terminal prompt appears (fallback).
- Toggle back to **CLI mode** → a new Bash command prompts only in the terminal (no card).

Expected: each transition matches. If a card sticks, check `~/.claude/feature-log/pending/<sid>.json` and `mode.json`.
