import type { Request } from "express";
import type { AuthScheme } from "../../core/auth";
import { ApiError } from "../../core/errors";

// The credential travels in an `x-api-key` header — not a bearer token, which
// is the single most common reason a client written against another provider
// fails here. `Authorization: Bearer` is accepted too: that is how OAuth
// callers authenticate, and the SDK sends it after `ant auth login`.
export const anthropicAuthScheme: AuthScheme = {
  extractKey(req: Request): string | undefined {
    const header = req.headers["x-api-key"];
    if (typeof header === "string" && header) return header;

    const authorization = req.headers.authorization;
    return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  },
  missingKeyError(): ApiError {
    return new ApiError(401, "x-api-key header is required", "authentication_error");
  },
  invalidKeyError(): ApiError {
    return new ApiError(401, "invalid x-api-key", "authentication_error");
  },
};
