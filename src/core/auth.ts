import type { NextFunction, Request, Response } from "express";
import type { ApiError } from "./errors";

// How a provider authenticates requests: where the key travels and which
// error each failure raises. Key validation itself is shared — every
// provider checks against the same api-keys.json set.
export interface AuthScheme {
  extractKey(req: Request): string | undefined;
  missingKeyError(): ApiError;
  invalidKeyError(key: string): ApiError;
}

export function createAuthMiddleware(validKeys: Set<string>, scheme: AuthScheme) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = scheme.extractKey(req);
    if (!key) throw scheme.missingKeyError();
    if (!validKeys.has(key)) throw scheme.invalidKeyError(key);
    next();
  };
}
