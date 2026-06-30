import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, countChanges, aggregate, groupRecords, STATUS_META, type FeatureRecord } from "./featureTypes.ts";

function rec(over: Partial<FeatureRecord> = {}): FeatureRecord {
  return {
    schemaVersion: 1,
    sessionId: "s",
    projectPath: "/p",
    projectName: "p",
    model: "claude-opus-4-8",
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    turns: 0,
    filesByArea: {},
    commands: [],
    userPrompts: [],
    summary: "",
    summaryHeadline: "",
    summarySource: "",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    estimatedCostUsd: 0,
    totalTokens: 0,
    ...over,
  };
}

test("deriveStatus: no activity → todo", () => {
  assert.equal(deriveStatus(rec()), "todo");
});

test("deriveStatus: turns or changes but no summary → in_progress", () => {
  assert.equal(deriveStatus(rec({ turns: 3 })), "in_progress");
  assert.equal(
    deriveStatus(rec({ filesByArea: { "Board UI": { created: ["a.tsx"], edited: [] } } })),
    "in_progress",
  );
});

test("deriveStatus: summary + source → done", () => {
  assert.equal(deriveStatus(rec({ summary: "did x", summarySource: "claude" })), "done");
});

test("deriveStatus: liveState awaiting_approval → awaiting_approval", () => {
  assert.equal(deriveStatus(rec({ turns: 2, liveState: "awaiting_approval" })), "awaiting_approval");
});

test("deriveStatus: liveState idle → idle", () => {
  assert.equal(deriveStatus(rec({ turns: 2, liveState: "idle" })), "idle");
});

test("deriveStatus: summary beats any liveState", () => {
  assert.equal(
    deriveStatus(rec({ summary: "did x", summarySource: "claude", liveState: "awaiting_approval" })),
    "done",
  );
});

test("deriveStatus: undefined liveState falls through to in_progress", () => {
  assert.equal(deriveStatus(rec({ turns: 2, liveState: undefined })), "in_progress");
});

test("STATUS_META has an entry for every Status", () => {
  for (const s of ["todo", "in_progress", "awaiting_approval", "idle", "done"] as const) {
    assert.ok(STATUS_META[s], `missing STATUS_META for ${s}`);
  }
});

test("countChanges sums created and edited across areas", () => {
  const r = rec({
    filesByArea: {
      "Board UI": { created: ["a.tsx"], edited: ["b.tsx"] },
      "Data layer & libs": { created: [], edited: ["c.ts"] },
    },
  });
  assert.equal(countChanges(r), 3);
});

test("aggregate rolls up counts, distinct projects, tokens and cost", () => {
  const a = aggregate([
    rec({ projectPath: "/a", totalTokens: 100, tokens: { input: 0, output: 40, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 1 }),
    rec({ projectPath: "/a", totalTokens: 50, tokens: { input: 0, output: 10, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 0.5 }),
    rec({ projectPath: "/b", totalTokens: 10, tokens: { input: 0, output: 5, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 0.25 }),
  ]);
  assert.deepEqual(a, {
    features: 3,
    projects: 2,
    totalTokens: 160,
    totalOutputTokens: 55,
    totalCostUsd: 1.75,
  });
});

// --- groupRecords ---

test("groupRecords by session: groups records sharing a sessionId", () => {
  const records = [
    rec({ sessionId: "s1", projectPath: "/a", projectName: "alpha", endedAt: "2026-01-02T00:00:00Z", tokens: { input: 0, output: 10, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 1, summaryHeadline: "Task A" }),
    rec({ sessionId: "s1", projectPath: "/b", projectName: "beta", endedAt: "2026-01-01T00:00:00Z", tokens: { input: 0, output: 5, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 0.5 }),
    rec({ sessionId: "s2", projectPath: "/a", projectName: "alpha", endedAt: "2026-01-03T00:00:00Z", tokens: { input: 0, output: 20, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 2, summaryHeadline: "Task B" }),
  ];
  const groups = groupRecords(records, "session");
  assert.equal(groups.length, 2);
  // s2 is newest overall, so it should come first
  assert.equal(groups[0].key, "s2");
  assert.equal(groups[0].records.length, 1);
  // s1 group has 2 records
  assert.equal(groups[1].key, "s1");
  assert.equal(groups[1].records.length, 2);
});

test("groupRecords by project: groups records sharing a projectPath", () => {
  const records = [
    rec({ sessionId: "s1", projectPath: "/a", projectName: "alpha", endedAt: "2026-01-01T00:00:00Z", tokens: { input: 0, output: 10, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 1 }),
    rec({ sessionId: "s2", projectPath: "/a", projectName: "alpha", endedAt: "2026-01-02T00:00:00Z", tokens: { input: 0, output: 15, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 2 }),
    rec({ sessionId: "s3", projectPath: "/b", projectName: "beta", endedAt: "2026-01-03T00:00:00Z", tokens: { input: 0, output: 5, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 0.5 }),
  ];
  const groups = groupRecords(records, "project");
  assert.equal(groups.length, 2);
  // /b is newest, comes first
  assert.equal(groups[0].key, "/b");
  assert.equal(groups[0].title, "beta");
  assert.equal(groups[0].subtitle, "1 feature");
  // /a group
  assert.equal(groups[1].key, "/a");
  assert.equal(groups[1].title, "alpha");
  assert.equal(groups[1].subtitle, "2 features");
});

test("groupRecords: totalOutputTokens and totalCostUsd are summed per group", () => {
  const records = [
    rec({ sessionId: "s1", projectPath: "/a", projectName: "alpha", endedAt: "2026-01-01T00:00:00Z", tokens: { input: 0, output: 100, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 1 }),
    rec({ sessionId: "s1", projectPath: "/a", projectName: "alpha", endedAt: "2026-01-02T00:00:00Z", tokens: { input: 0, output: 200, cacheRead: 0, cacheCreation: 0 }, estimatedCostUsd: 3 }),
  ];
  const groups = groupRecords(records, "session");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].totalOutputTokens, 300);
  assert.equal(groups[0].totalCostUsd, 4);
});

test("groupRecords: records within a group are sorted newest first", () => {
  const records = [
    rec({ sessionId: "s1", endedAt: "2026-01-01T00:00:00Z" }),
    rec({ sessionId: "s1", endedAt: "2026-01-03T00:00:00Z" }),
    rec({ sessionId: "s1", endedAt: "2026-01-02T00:00:00Z" }),
  ];
  const groups = groupRecords(records, "session");
  assert.equal(groups[0].records[0].endedAt, "2026-01-03T00:00:00Z");
  assert.equal(groups[0].records[2].endedAt, "2026-01-01T00:00:00Z");
});

test("groupRecords by session: title falls back to first userPrompt when no headline", () => {
  const records = [
    rec({ sessionId: "s1", summaryHeadline: "", userPrompts: ["add dark mode"], endedAt: "2026-01-01T00:00:00Z" }),
  ];
  const groups = groupRecords(records, "session");
  assert.equal(groups[0].title, "add dark mode");
});

test("groupRecords by session: title falls back to sessionId prefix when nothing else", () => {
  const records = [
    rec({ sessionId: "abcdefgh-1234", summaryHeadline: "", userPrompts: [], endedAt: "2026-01-01T00:00:00Z" }),
  ];
  const groups = groupRecords(records, "session");
  assert.equal(groups[0].title, "abcdefgh");
});

test("groupRecords: empty input returns empty array", () => {
  assert.deepEqual(groupRecords([], "session"), []);
  assert.deepEqual(groupRecords([], "project"), []);
});

test("groupRecords by session: subtitle lists distinct project names", () => {
  const records = [
    rec({ sessionId: "s1", projectName: "alpha", endedAt: "2026-01-01T00:00:00Z" }),
    rec({ sessionId: "s1", projectName: "beta", endedAt: "2026-01-02T00:00:00Z" }),
    rec({ sessionId: "s1", projectName: "alpha", endedAt: "2026-01-03T00:00:00Z" }),
  ];
  const groups = groupRecords(records, "session");
  assert.ok(groups[0].subtitle.includes("alpha"));
  assert.ok(groups[0].subtitle.includes("beta"));
});
