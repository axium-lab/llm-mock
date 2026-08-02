import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../core/errors";
import { classicEnvelope, isFrontendFailure, nextGenEnvelope } from "../google-shared/errors";

// Which of Google's two envelopes applies depends on the path. On AI Studio,
// /interactions is the only next-gen surface; everything else — /models,
// /files, /cachedContents — answers in google.rpc.Status. See
// ../google-shared/errors for how each envelope is built.
//
// `ApiError.code` carries the Google *reason* (API_KEY_INVALID, ...), which is
// the more specific of the two vocabularies; the next-gen serializer derives
// its own code from the HTTP status instead.

const SERVICE = "generativelanguage.googleapis.com";

// Paths here are relative to the provider mount point (/gemini).
const NEXT_GEN_PATH = /^\/v1(beta|alpha)?\/interactions(\/|$)/;

export function isNextGenSurface(req: Request): boolean {
  return NEXT_GEN_PATH.test(req.path);
}

function serialize(req: Request, status: number, message: string, reason: string | null) {
  // A credential is rejected before the service runs, so an auth failure keeps
  // the classic envelope even on the next-gen surface.
  return isNextGenSurface(req) && !isFrontendFailure(reason)
    ? nextGenEnvelope(status, message)
    : classicEnvelope(status, message, reason, SERVICE);
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
