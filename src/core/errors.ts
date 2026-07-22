import type { NextFunction, Request, Response } from "express";

// Provider-neutral API error. Each provider's error handler serializes it to
// that provider's wire envelope, so routes and services never encode one.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null = null,
    public param: string | null = null,
  ) {
    super(message);
  }
}

// Fallback handlers for requests outside any provider namespace
// (/health, /__mock, unknown roots). Providers ship their own pair.
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { message: `Unknown request URL: ${req.method} ${req.path}` } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code } });
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: { message } });
}
