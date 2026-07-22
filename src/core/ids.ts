import { createHash } from "node:crypto";

// Same payload always yields the same id, which keeps snapshot tests stable.
export function deterministicId(prefix: string, payload: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `${prefix}${hash.slice(0, 24)}`;
}
