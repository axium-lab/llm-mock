import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../core/errors";

// Every request carries an `anthropic-version` header — no other provider
// mocked here versions by header, and forgetting it is the classic failure
// when calling this API by hand. The SDK always sends it.
//
// Any value is accepted. Validating against a list of known versions would be
// more faithful, but it would also mean maintaining that list and guessing
// what to do with versions that do not exist yet.
export function requireVersion(req: Request, _res: Response, next: NextFunction): void {
  const version = req.headers["anthropic-version"];
  if (typeof version !== "string" || !version) {
    throw new ApiError(400, "anthropic-version header is required", "invalid_request_error");
  }
  next();
}
