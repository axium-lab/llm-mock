import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errors";

// x-llm-mock-status forces an HTTP status code, allowing tests to simulate
// transient provider errors (500, 503, 529, 429) without waiting for live outages.
export const STATUS_HEADER = "x-llm-mock-status";

// x-llm-mock-delay holds a request before answering, allowing tests to provoke
// slow upstreams and SDK timeouts without altering response determinism.
export const DELAY_HEADER = "x-llm-mock-delay";

// Small upper bound so a single request cannot tie up sockets or timers for long
// — especially important on the shared hosted instance.
export const MAX_DELAY_MS = 10_000;

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

function parseStatus(req: Request): number | undefined {
  const raw = req.headers[STATUS_HEADER];
  if (raw === undefined) return undefined;

  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const status = /^\d{3}$/.test(trimmed) ? Number(trimmed) : NaN;
  if (Number.isNaN(status) || status < 400 || status > 599) {
    throw new ApiError(
      400,
      `Header ${STATUS_HEADER} must be a valid HTTP error status code between 400 and 599.`,
      "invalid_value",
      STATUS_HEADER,
    );
  }
  return status;
}

function parseDelay(req: Request): number | undefined {
  const raw = req.headers[DELAY_HEADER];
  if (raw === undefined) return undefined;

  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const delay = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isSafeInteger(delay) || delay < 0 || delay > MAX_DELAY_MS) {
    throw new ApiError(
      400,
      `Header ${DELAY_HEADER} must be an integer between 0 and ${MAX_DELAY_MS} (milliseconds).`,
      "invalid_value",
      DELAY_HEADER,
    );
  }
  return delay;
}

function statusError(status: number, res: Response): ApiError {
  if (status === 429) {
    res.setHeader("retry-after", "1");
  }
  return new ApiError(status, defaultMessage(status), null);
}

// Tracks responses that have already passed through chaosMiddleware so a
// fallthrough across router branches (e.g. Gemini's /openai compat layer
// falling through to the main router) never applies the delay twice.
const applied = new WeakSet<Response>();

export function chaosMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (applied.has(res)) {
    next();
    return;
  }
  applied.add(res);

  // Validate both headers before scheduling any timer so bad input fails fast.
  // Status is parsed first to preserve its precedence when both are invalid.
  const status = parseStatus(req);
  const delayMs = parseDelay(req);

  const proceed = () => {
    if (status !== undefined) {
      next(statusError(status, res));
      return;
    }
    next();
  };

  if (!delayMs) {
    proceed();
    return;
  }

  if (res.writableEnded || res.destroyed) return;

  const onClose = () => {
    clearTimeout(timer);
  };

  const timer = setTimeout(() => {
    res.off("close", onClose);
    if (res.writableEnded || res.destroyed) return;
    proceed();
  }, delayMs);

  res.once("close", onClose);
}
