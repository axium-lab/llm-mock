import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errors";

// x-llm-mock-status forces an HTTP status code, allowing tests to simulate
// transient provider errors (500, 503, 529, 429) without waiting for live outages.
export const STATUS_HEADER = "x-llm-mock-status";

function defaultMessage(status: number): string {
  switch (status) {
    case 429:
      return "Rate limit reached.";
    case 500:
      return "The server had an error while processing your request.";
    case 503:
      return "The server is temporarily unavailable.";
    case 529:
      return "The server is temporarily overloaded.";
    default:
      return `Simulated error (${status}) provoked via ${STATUS_HEADER}.`;
  }
}

export function chaosMiddleware(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers[STATUS_HEADER];
  if (raw === undefined) {
    next();
    return;
  }

  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const status = /^\d{3}$/.test(trimmed) ? Number(trimmed) : NaN;
  if (isNaN(status) || status < 400 || status > 599) {
    throw new ApiError(
      400,
      `Header ${STATUS_HEADER} must be a valid HTTP error status code between 400 and 599.`,
      "invalid_value",
      STATUS_HEADER,
    );
  }

  if (status === 429) {
    res.setHeader("retry-after", "1");
  }

  throw new ApiError(status, defaultMessage(status), null);
}
