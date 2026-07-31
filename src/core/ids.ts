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

// Ids that carry their own metadata. Resources like files and uploads are
// created by one request and read back by another, which normally requires
// server state; encoding the metadata into the id keeps the mock stateless
// while still letting a create -> retrieve round-trip agree on filename,
// size and purpose. Deterministic too: the same payload yields the same id.
export function encodeMetaId(prefix: string, meta: object): string {
  return `${prefix}${Buffer.from(JSON.stringify(meta), "utf-8").toString("base64url")}`;
}

// Returns undefined for ids the mock did not mint (a hand-written id, or one
// from a real OpenAI account), letting callers fall back to synthetic data.
export function decodeMetaId<T>(prefix: string, id: string): T | undefined {
  if (!id.startsWith(prefix)) return undefined;
  try {
    const json = Buffer.from(id.slice(prefix.length), "base64url").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as T;
  } catch {
    return undefined;
  }
}
