import type { Request } from "express";

// Stateless response control: each request carries its own canned response,
// so identical requests always produce identical responses — no server-side
// registration, no shared state between requests or replicas.
//
// x-llm-mock-response takes plain text (HTTP headers are latin-1, so ASCII
// is safe); the -base64 variant carries UTF-8 content that headers cannot
// transport verbatim, and wins when both are present.
export function responseOverride(req: Request): string | undefined {
  const encoded = req.headers["x-llm-mock-response-base64"];
  if (typeof encoded === "string") return Buffer.from(encoded, "base64").toString("utf-8");
  const plain = req.headers["x-llm-mock-response"];
  return typeof plain === "string" ? plain : undefined;
}
