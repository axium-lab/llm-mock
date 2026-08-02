import { ApiError } from "../../core/errors";
import type { CallerScope } from "./types";

// The Interactions API is reached through a path this platform builds oddly:
// the SDK folds the whole version segment — which in regional mode already
// carries the project and location — into a single URL-encoded path component.
//
//   express   /v1beta1/interactions
//   regional  /v1beta1%2Fprojects%2F{p}%2Flocations%2F{l}/interactions
//
// Express matches on the still-encoded path, so a literal "/v1beta1" mount
// never sees the regional form. A route parameter does, and hands the value
// back decoded, which is what makes one route serve both shapes.
const SCOPE = /^(v1beta1|v1)(?:\/projects\/([^/]+)\/locations\/([^/]+))?$/;

export interface VersionedScope extends CallerScope {
  version: string;
}

export function parseScope(segment: string): VersionedScope | undefined {
  const match = SCOPE.exec(segment);
  if (!match) return undefined;
  return { version: match[1]!, project: match[2], location: match[3] };
}

export function assertScope(segment: string | undefined): VersionedScope {
  const scope = segment ? parseScope(segment) : undefined;
  if (!scope) {
    throw new ApiError(404, `Unknown API version or location: ${segment ?? ""}`, "NOT_FOUND");
  }
  return scope;
}
