import type { NextFunction, Request, Response } from "express";

// Error that serializes to the OpenAI error envelope:
// { "error": { "message", "type", "param", "code" } }
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public type: string = "invalid_request_error",
    public code: string | null = null,
    public param: string | null = null,
  ) {
    super(message);
  }
}

function errorBody(message: string, type: string, param: string | null, code: string | null) {
  return { error: { message, type, param, code } };
}

export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json(
      errorBody(
        `Unknown request URL: ${req.method} ${req.path}. Please check the URL for typos.`,
        "invalid_request_error",
        null,
        "unknown_url",
      ),
    );
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(errorBody(err.message, err.type, err.param, err.code));
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json(errorBody(message, "api_error", null, null));
}
