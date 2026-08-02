import type { NextFunction, Request, Response } from "express";
import type { ApiError } from "./errors";

// How a provider authenticates requests: where the key travels and which
// error each failure raises. Key validation itself is shared — every
// provider checks against the same api-keys.json set.
export interface AuthScheme {
  extractKey(req: Request): string | undefined;
  missingKeyError(): ApiError;
  // The request is passed along because a provider may accept a credential
  // through more than one transport and report each rejection differently —
  // Gemini Enterprise answers a bad OAuth token and a bad express API key with
  // different statuses entirely.
  invalidKeyError(key: string, req: Request): ApiError;
}

export function createAuthMiddleware(validKeys: Set<string>, scheme: AuthScheme) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = scheme.extractKey(req);
    if (!key) throw scheme.missingKeyError();
    if (!validKeys.has(key)) throw scheme.invalidKeyError(key, req);
    next();
  };
}
