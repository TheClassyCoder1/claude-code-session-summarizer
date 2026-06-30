import { test } from "node:test";
import assert from "node:assert/strict";
import { recordFromJson } from "./featureLog.ts";

function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessionId: "abc-123",
    projectPath: "/home/user/project",
    projectName: "project",
    model: "claude-opus-4-8",
    tokens: { input: 1000, output: 500, cacheRead: 200, cacheCreation: 100 },
    turns: 3,
    filesByArea: {
      "Board UI": { created: ["a.tsx"], edited: ["b.tsx"] },
    },
    commands: ["npm test"],
    userPrompts: ["fix the bug"],
    summary: "Fixed a rendering bug",
    summaryHeadline: "Bug fix",
    summarySource: "claude",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:05:00Z",
    updatedAt: "2026-01-01T00:05:00Z",
    ...overrides,
  };
}

// --- recordFromJson: valid inputs ---

test("recordFromJson: parses a valid record and derives totalTokens", () => {
  const r = recordFromJson(JSON.stringify(validRecord()));
  assert.ok(r);
  // 1000 + 500 + 200 + 100 = 1800
  assert.equal(r.totalTokens, 1800);
});

test("recordFromJson: derives estimatedCostUsd from model and tokens", () => {
  const r = recordFromJson(JSON.stringify(validRecord()));
  assert.ok(r);
  assert.equal(typeof r.estimatedCostUsd, "number");
  assert.ok(r.estimatedCostUsd > 0);
});

test("recordFromJson: preserves all original fields", () => {
  const r = recordFromJson(JSON.stringify(validRecord()));
  assert.ok(r);
  assert.equal(r.sessionId, "abc-123");
  assert.equal(r.projectName, "project");
  assert.equal(r.model, "claude-opus-4-8");
  assert.equal(r.turns, 3);
  assert.equal(r.summary, "Fixed a rendering bug");
  assert.deepEqual(r.commands, ["npm test"]);
});

test("recordFromJson: includes optional liveState when present", () => {
  const r = recordFromJson(JSON.stringify(validRecord({ liveState: "idle" })));
  assert.ok(r);
  assert.equal(r.liveState, "idle");
});

test("recordFromJson: includes optional summaryCostUsd when present", () => {
  const r = recordFromJson(JSON.stringify(validRecord({ summaryCostUsd: 0.05 })));
  assert.ok(r);
  assert.equal(r.summaryCostUsd, 0.05);
});

test("recordFromJson: includes optional summaryUsage when present", () => {
  const usage = { input_tokens: 100, output_tokens: 50 };
  const r = recordFromJson(JSON.stringify(validRecord({ summaryUsage: usage })));
  assert.ok(r);
  assert.deepEqual(r.summaryUsage, usage);
});

// --- recordFromJson: invalid inputs ---

test("recordFromJson: returns null for invalid JSON", () => {
  assert.equal(recordFromJson("not json at all"), null);
  assert.equal(recordFromJson("{broken"), null);
});

test("recordFromJson: returns null for empty string", () => {
  assert.equal(recordFromJson(""), null);
});

test("recordFromJson: returns null when required field is missing", () => {
  const incomplete = { ...validRecord() };
  delete incomplete.sessionId;
  assert.equal(recordFromJson(JSON.stringify(incomplete)), null);
});

test("recordFromJson: returns null when tokens have wrong shape", () => {
  const bad = validRecord({ tokens: { input: "not a number" } });
  assert.equal(recordFromJson(JSON.stringify(bad)), null);
});

test("recordFromJson: returns null for a valid JSON array (not object)", () => {
  assert.equal(recordFromJson("[1,2,3]"), null);
});

test("recordFromJson: returns null for a valid JSON number", () => {
  assert.equal(recordFromJson("42"), null);
});

// --- recordFromJson: cost calculation correctness ---

test("recordFromJson: opus cost matches manual calculation", () => {
  const tokens = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 };
  const r = recordFromJson(JSON.stringify(validRecord({ tokens })));
  assert.ok(r);
  // Opus: in=$5/M, out=$25/M, cacheRead=$5*0.1=$0.5/M, cacheCreation=$5*1.25=$6.25/M
  // 5 + 25 + 0.5 + 6.25 = 36.75
  assert.equal(r.estimatedCostUsd, 36.75);
});

test("recordFromJson: zero tokens produce zero cost", () => {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const r = recordFromJson(JSON.stringify(validRecord({ tokens })));
  assert.ok(r);
  assert.equal(r.estimatedCostUsd, 0);
  assert.equal(r.totalTokens, 0);
});

test("recordFromJson: liveState rejects invalid enum value", () => {
  const r = recordFromJson(JSON.stringify(validRecord({ liveState: "invalid_state" })));
  assert.equal(r, null);
});
