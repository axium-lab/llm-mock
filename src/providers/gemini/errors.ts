import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../core/errors";

// Gemini ships two different error envelopes and which one you get depends on
// the surface you called:
//
//   classic (/models, /files, /cachedContents, ...) — the google.rpc.Status
//   envelope shared by every Google Cloud API:
//     { "error": { "code": 400, "message", "status": "INVALID_ARGUMENT",
//                  "details": [ ... ] } }
//
//   next-gen (/interactions) — a flatter, OpenAI-looking envelope introduced
//   with the Interactions API:
//     { "error": { "code": "invalid_request", "message" } }
//
// `ApiError.code` carries the Google *reason* (API_KEY_INVALID, ...), which is
// the more specific of the two vocabularies; the next-gen serializer derives
// its own code from the HTTP status instead.

const RPC_STATUS: Record<number, string> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  429: "RESOURCE_EXHAUSTED",
  499: "CANCELLED",
  500: "INTERNAL",
  503: "UNAVAILABLE",
};

const NEXT_GEN_CODE: Record<number, string> = {
  400: "invalid_request",
  401: "authentication",
  403: "permission_denied",
  404: "not_found",
  429: "rate_limit_exceeded",
  499: "cancelled",
  500: "api_error",
  503: "service_unavailable",
};

const SERVICE = "generativelanguage.googleapis.com";

// Requests under /interactions get the next-gen envelope; everything else the
// classic one. Paths here are relative to the provider mount point (/gemini).
const NEXT_GEN_PATH = /^\/v1(beta|alpha)?\/interactions(\/|$)/;

// Credentials are checked by Google's API frontend, which sits ahead of every
// service and answers in the classic envelope on all of them — including
// /interactions, whose own errors use the next-gen one. Verified against the
// live API: a bad key on /interactions comes back as google.rpc.Status.
const FRONTEND_REASONS = new Set(["API_KEY_INVALID", "API_KEY_MISSING", "REQUESTED_ENTITY_NOT_FOUND"]);

export function isNextGenSurface(req: Request): boolean {
  return NEXT_GEN_PATH.test(req.path);
}

// Only an invalid API key carries details; every other error observed on the
// live API — missing credential, unknown model, unknown file, a malformed
// request body — reports code/message/status and nothing else.
function detailsFor(reason: string | null, message: string) {
  if (reason !== "API_KEY_INVALID") return {};
  return {
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason,
        domain: "googleapis.com",
        metadata: { service: SERVICE },
      },
      { "@type": "type.googleapis.com/google.rpc.LocalizedMessage", locale: "en-US", message },
    ],
  };
}

function classicEnvelope(status: number, message: string, reason: string | null) {
  return {
    error: {
      code: status,
      message,
      status: RPC_STATUS[status] ?? "UNKNOWN",
      ...detailsFor(reason, message),
    },
  };
}

function nextGenEnvelope(status: number, message: string) {
  return { error: { code: NEXT_GEN_CODE[status] ?? "api_error", message } };
}

function serialize(req: Request, status: number, message: string, reason: string | null) {
  const fromFrontend = reason !== null && FRONTEND_REASONS.has(reason);
  return isNextGenSurface(req) && !fromFrontend
    ? nextGenEnvelope(status, message)
    : classicEnvelope(status, message, reason);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(serialize(req, 404, `Unknown request URL: ${req.method} ${req.baseUrl}${req.path}`, null));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(serialize(req, err.status, err.message, err.code));
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json(serialize(req, 500, message, null));
}
