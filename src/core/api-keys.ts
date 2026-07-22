import { readFileSync } from "node:fs";

export function loadApiKeys(file: string): Set<string> {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
  if (!Array.isArray(parsed) || parsed.some((key) => typeof key !== "string")) {
    throw new Error(`${file} must contain a JSON array of API key strings`);
  }
  return new Set(parsed as string[]);
}
