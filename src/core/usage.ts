// Rough token approximation (~4 characters per token). Close enough for
// tests that assert usage is present and coherent.
export function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
