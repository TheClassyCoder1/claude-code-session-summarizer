import Anthropic from "@anthropic-ai/sdk";

// Default to the latest, most capable Claude model.
export const CLAUDE_MODEL = "claude-opus-4-8";

/**
 * Construct the Anthropic client lazily so a missing key produces a clean,
 * user-facing error at request time instead of crashing module import.
 */
export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local to use the Claude features.",
    );
  }
  return new Anthropic({ apiKey });
}
