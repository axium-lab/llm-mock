import { createHash } from "node:crypto";

// Same payload always yields the same id, which keeps snapshot tests stable.
export function deterministicId(prefix: string, payload: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `${prefix}${hash.slice(0, 24)}`;
}

// Pseudo-timestamp derived from the id instead of the clock, so identical
// requests return byte-identical responses. The fixed range keeps values
// plausible (epoch seconds, late 2023 onwards).
export function deterministicCreated(id: string): number {
  const hash = createHash("sha256").update(id).digest();
  return 1_700_000_000 + (hash.readUInt32BE(0) % 10_000_000);
}
