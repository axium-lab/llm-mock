import type { Request } from "express";

// Every versioned surface is served under both /v1beta and /v1, so an error
// message that names the version has to read it back off the path the caller
// used rather than assume the SDK default. Matched against req.baseUrl, which
// still carries the provider mount ("/gemini/v1beta/models"), hence unanchored.
const VERSION = /\/(v1beta|v1)(?=\/|$)/;

export function apiVersion(req: Request): string {
  return VERSION.exec(req.baseUrl)?.[1] ?? "v1beta";
}
