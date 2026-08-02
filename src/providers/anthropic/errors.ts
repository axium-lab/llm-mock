import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../core/errors";

// Anthropic wraps the error object twice and echoes the request id in the body:
//
//   { "type": "error",
//     "error": { "type": "invalid_request_error", "message": "..." },
//     "request_id": "req_011CSHoEeqs5C35K2UUqR7Fy" }
//
// `ApiError.code` carries the error `type` when a caller wants a specific one;
// otherwise it is derived from the status.
const ERROR_TYPE: Record<number, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  404: "not_found_error",
  413: "request_too_large",
  429: "rate_limit_error",
  500: "api_error",
  // 529 is Anthropic's own: no other provider mocked here uses it.
  529: "overloaded_error",
};

// The app already stamps every response with an x-request-id; reusing it keeps
// the header and the body in agreement, as they are on the real API.
function requestId(res: Response): string {
  const header = res.getHeader("x-request-id");
  return typeof header === "string" ? header : "req_unknown";
}

function envelope(res: Response, status: number, message: string, type: string | null) {
  return {
    type: "error",
    error: { type: type ?? ERROR_TYPE[status] ?? "api_error", message },
    request_id: requestId(res),
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json(envelope(res, 404, `Not found: ${req.method} ${req.baseUrl}${req.path}`, null));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(envelope(res, err.status, err.message, err.code));
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json(envelope(res, 500, message, null));
}
