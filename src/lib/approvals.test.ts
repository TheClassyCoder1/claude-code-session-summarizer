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
