import { test } from "node:test";
import assert from "node:assert/strict";
import { HOOK_EVENTS, pruneStaleHooks, INSTALLS } from "./install.mjs";

const CMD = "~/.claude/feature-logger/feature-logger.mjs";
const ours = () => ({ matcher: "", hooks: [{ type: "command", command: CMD }] });

test("HOOK_EVENTS covers lifecycle + the live-state events", () => {
  assert.deepEqual(
    [...HOOK_EVENTS].sort(),
    ["Notification", "PostToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"],
  );
});

test("pruneStaleHooks drops our command from events no longer wanted", () => {
  const hooks = { Stop: [ours()], PreToolUse: [ours()] };
  const pruned = pruneStaleHooks(hooks, CMD, ["Stop"]);
  assert.deepEqual(pruned, ["PreToolUse"]);
  assert.equal(hooks.PreToolUse, undefined); // emptied → removed
  assert.equal(hooks.Stop.length, 1); // kept
});

test("pruneStaleHooks preserves other tools' hooks on a stale event", () => {
  const other = { matcher: "", hooks: [{ type: "command", command: "/other/tool.sh" }] };
  const hooks = { PreToolUse: [ours(), other] };
  const pruned = pruneStaleHooks(hooks, CMD, ["Stop"]);
  assert.deepEqual(pruned, ["PreToolUse"]);
  assert.deepEqual(hooks.PreToolUse, [other]); // only ours removed; event kept
});

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
  const pruned = pruneStaleHooks(hooks, FL, HOOK_EVENTS);
  assert.deepEqual(pruned, ["PreToolUse"]);
  assert.equal(hooks.PreToolUse.length, 1);
  assert.equal(hooks.PreToolUse[0].hooks[0].command, AG);
});

test("pruneStaleHooks leaves wanted events and untouched events alone", () => {
  const hooks = { Stop: [ours()], Notification: [ours()] };
  const pruned = pruneStaleHooks(hooks, CMD, HOOK_EVENTS);
  assert.deepEqual(pruned, []);
  assert.equal(hooks.Stop.length, 1);
  assert.equal(hooks.Notification.length, 1);
});
