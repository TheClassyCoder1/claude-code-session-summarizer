import { promises as fs } from "fs";
import path from "path";
import os from "os";

// Reads your local Claude Code history (~/.claude/projects/<proj>/<session>.jsonl)
// and reconstructs "what you worked on" as work items — entirely offline, no API
// key. Each session transcript is a stream of JSON events (your prompts, the
// assistant's actions). We group the assistant's file edits and meaningful
// commands under the human prompt that triggered them.

export type WorkItem = {
  sourceKey: string; // stable id for dedup across re-imports
  title: string;
  body: string;
  details: string;
  project: string;
};

const MUTATING = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// "user" messages the transcript stores that you never actually typed
// (injected skill/tool/system text, or the harness's continuation nudge).
const INJECTION = [
  /^Base directory for this skill/,
  /^<command-/,
  /^Caveat:/i,
  /system-reminder/i,
  /^\[Request interrupted/,
  /^Result of calling/,
  /^The user (opened|approved|rejected|selected)/,
  /^API Error/,
  /^Continue from where you left off/i,
];

// Commands worth surfacing even when a turn changed no files (e.g. "merge to main").
const SIGNIFICANT_CMD =
  /\b(git\s+(commit|push|merge|rebase|tag)|npm\s+(install|i|ci)|npx\s+create-|prisma\s+migrate|npm\s+run\s+(build|test|lint)|yarn\s+\w|pnpm\s+(install|add))/;

function isRealPrompt(text: string | null | undefined): text is string {
  if (!text) return false;
  const t = text.trim();
  if (!t || t.length > 1500) return false;
  return !INJECTION.some((re) => re.test(t));
}

function shorten(p: string, cwd: string | null): string {
  if (cwd && p.startsWith(cwd + "/")) return p.slice(cwd.length + 1);
  return p;
}

function actionLabel(created: number, edited: number, commands: number): string {
  if (created) return `Created ${created} file${created > 1 ? "s" : ""}`;
  if (edited) return `Edited ${edited} file${edited > 1 ? "s" : ""}`;
  if (commands) return `Ran ${commands} command${commands > 1 ? "s" : ""}`;
  return "Work item";
}

type Turn = {
  prompt: string;
  created: Set<string>;
  edited: Set<string>;
  commands: string[];
};

function parseSession(raw: string, sessionId: string): WorkItem[] {
  const lines = raw.trim().split("\n");
  let cwd: string | null = null;
  const turns: Turn[] = [];
  let cur: Turn | null = null;

  const close = () => {
    if (
      cur &&
      (cur.created.size > 0 ||
        cur.edited.size > 0 ||
        cur.commands.some((c) => SIGNIFICANT_CMD.test(c)))
    ) {
      turns.push(cur);
    }
    cur = null;
  };

  for (const line of lines) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof o.cwd === "string") cwd = o.cwd;

    const message = o.message as { content?: unknown } | undefined;

    if (o.type === "user") {
      const content = message?.content;
      let text: string | null = null;
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        const tb = content.find(
          (b) => b && typeof b === "object" && (b as { type?: string }).type === "text",
        ) as { text?: string } | undefined;
        if (tb?.text) text = tb.text; // ignore tool_result-only user messages
      }
      if (isRealPrompt(text)) {
        close();
        cur = { prompt: text.trim(), created: new Set(), edited: new Set(), commands: [] };
      }
    } else if (o.type === "assistant" && cur) {
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (!b || typeof b !== "object") continue;
        const block = b as { type?: string; name?: string; input?: Record<string, unknown> };
        if (block.type !== "tool_use") continue;
        const inp = block.input ?? {};
        if (block.name === "Write" && typeof inp.file_path === "string") {
          cur.created.add(inp.file_path);
        } else if (MUTATING.has(block.name ?? "")) {
          const fp = (inp.file_path ?? inp.notebook_path) as string | undefined;
          if (typeof fp === "string") cur.edited.add(fp);
        } else if (block.name === "Bash" && typeof inp.command === "string") {
          cur.commands.push(inp.command);
        }
      }
    }
  }
  close();

  return turns.map((t, i): WorkItem => {
    const created = [...t.created];
    const edited = [...t.edited].filter((f) => !t.created.has(f));
    const cmds = dedupe(
      t.commands.map((c) => c.split("\n")[0].trim().slice(0, 80)).filter(Boolean),
    ).slice(0, 6);

    const firstLine = (t.prompt.split("\n").find((l) => l.trim()) ?? "").trim();
    const title = firstLine.slice(0, 80) || actionLabel(created.length, edited.length, cmds.length);

    const parts: string[] = [];
    if (created.length) parts.push(`created ${created.length}`);
    if (edited.length) parts.push(`edited ${edited.length}`);
    if (cmds.length) parts.push(`${cmds.length} command${cmds.length > 1 ? "s" : ""}`);
    const body = parts.length ? `Files ${parts.join(", ")}.` : "Work item.";

    const detailLines: string[] = [];
    if (cwd) detailLines.push(`Project: ${cwd}`);
    if (created.length) detailLines.push(`Created: ${created.map((f) => shorten(f, cwd)).join(", ")}`);
    if (edited.length) detailLines.push(`Edited: ${edited.map((f) => shorten(f, cwd)).join(", ")}`);
    if (cmds.length) detailLines.push(`Ran:\n${cmds.map((c) => `  • ${c}`).join("\n")}`);

    return {
      sourceKey: `${sessionId}#${i}`,
      title,
      body,
      details: detailLines.join("\n"),
      project: cwd ?? "",
    };
  });
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/** Scan every Claude Code project on this machine and return all work items. */
export async function readClaudeCodeWorkItems(): Promise<WorkItem[]> {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(projectsDir);
  } catch {
    return []; // no Claude Code history on this machine
  }

  const items: WorkItem[] = [];
  for (const proj of projectDirs) {
    const dir = path.join(projectsDir, proj);
    let files: string[];
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) continue;
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const raw = await fs.readFile(path.join(dir, file), "utf8");
        items.push(...parseSession(raw, path.basename(file, ".jsonl")));
      } catch {
        // skip unreadable/partial transcript
      }
    }
  }
  return items;
}
