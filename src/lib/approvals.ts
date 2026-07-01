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
const decisionsDir = () => path.join(base(), "decisions");
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
      const p = pendingSchema.parse(
        JSON.parse(await fs.readFile(path.join(pendingDir(), f), "utf8")),
      );
      if (now - Date.parse(p.createdAt) <= WINDOW_MS) out.push(p);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}
