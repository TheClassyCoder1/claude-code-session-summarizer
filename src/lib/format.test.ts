import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTokens, formatUsd, shortModel, formatDate } from "./format.ts";

// --- formatTokens ---

test("formatTokens: values below 1k are returned as plain numbers", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(1), "1");
  assert.equal(formatTokens(999), "999");
});

test("formatTokens: exact thousands use no decimal", () => {
  assert.equal(formatTokens(1000), "1k");
  assert.equal(formatTokens(5000), "5k");
});

test("formatTokens: non-round thousands show one decimal", () => {
  assert.equal(formatTokens(1500), "1.5k");
  assert.equal(formatTokens(12345), "12.3k");
});

test("formatTokens: exact millions use no decimal", () => {
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(3_000_000), "3M");
});

test("formatTokens: non-round millions show one decimal", () => {
  assert.equal(formatTokens(1_500_000), "1.5M");
  assert.equal(formatTokens(2_345_678), "2.3M");
});

// --- formatUsd ---

test("formatUsd: null and undefined return em-dash", () => {
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd(undefined), "—");
});

test("formatUsd: zero formats with two decimals", () => {
  assert.equal(formatUsd(0), "$0.00");
});

test("formatUsd: tiny positive values use four decimals", () => {
  assert.equal(formatUsd(0.001), "$0.0010");
  assert.equal(formatUsd(0.0099), "$0.0099");
});

test("formatUsd: values >= 0.01 use two decimals", () => {
  assert.equal(formatUsd(0.01), "$0.01");
  assert.equal(formatUsd(1.5), "$1.50");
  assert.equal(formatUsd(25), "$25.00");
});

test("formatUsd: negative values format normally with two decimals", () => {
  assert.equal(formatUsd(-3.5), "$-3.50");
});

// --- shortModel ---

test("shortModel: strips claude- prefix", () => {
  assert.equal(shortModel("claude-opus-4-8"), "opus-4-8");
  assert.equal(shortModel("claude-sonnet-4-6"), "sonnet-4-6");
});

test("shortModel: strips date suffix", () => {
  assert.equal(shortModel("claude-opus-4-8-20260101"), "opus-4-8");
});

test("shortModel: strips provider prefix", () => {
  assert.equal(shortModel("us.anthropic.claude-opus-4-8"), "opus-4-8");
});

test("shortModel: strips context-window tag", () => {
  assert.equal(shortModel("claude-opus-4-8[1m]"), "opus-4-8");
});

test("shortModel: strips all decorations at once", () => {
  assert.equal(
    shortModel("us.anthropic.claude-sonnet-4-6-20260101[1m]"),
    "sonnet-4-6",
  );
});

test("shortModel: non-claude model only strips prefix/suffix", () => {
  assert.equal(shortModel("some-future-model"), "some-future-model");
});

// --- formatDate ---

test("formatDate: extracts yyyy-mm-dd from ISO timestamp", () => {
  assert.equal(formatDate("2026-01-15T10:30:00Z"), "2026-01-15");
});

test("formatDate: already-short date string is returned as-is", () => {
  assert.equal(formatDate("2026-01-15"), "2026-01-15");
});

test("formatDate: non-string or too-short string is returned raw", () => {
  assert.equal(formatDate("short"), "short");
  assert.equal(formatDate(""), "");
});
