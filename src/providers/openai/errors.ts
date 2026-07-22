import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../core/errors";

// Serializes errors to the OpenAI envelope:
// { "error": { "message", "type", "param", "code" } }
// The `type` field is OpenAI vocabulary, so it is derived here from the
// HTTP status instead of traveling inside the neutral ApiError.
function envelope(status: number, message: string, param: string | null, code: string | null) {
  return {
    error: {
      message,
      type: status < 500 ? "invalid_request_error" : "api_error",
      param,
      code,
    },
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json(
      envelope(
        404,
        `Unknown request URL: ${req.method} ${req.baseUrl}${req.path}. Please check the URL for typos.`,
        null,
        "unknown_url",
      ),
    );
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(envelope(err.status, err.message, err.param, err.code));
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json(envelope(500, message, null, null));
}
