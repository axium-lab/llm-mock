import { createHash } from "node:crypto";

// Deterministic pseudo-random unit vector seeded by the input text, so the same
// input always produces the same embedding. Shared by every provider: what
// differs between them is the wire envelope and the default dimension count,
// not how a plausible vector is conjured.
export function deterministicVector(seedText: string, dimensions: number): number[] {
  const values: number[] = [];
  let counter = 0;
  while (values.length < dimensions) {
    const hash = createHash("sha256").update(`${seedText}:${counter++}`).digest();
    for (let i = 0; i + 1 < hash.length && values.length < dimensions; i += 2) {
      values.push((hash.readUInt16BE(i) / 0xffff) * 2 - 1);
    }
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}
