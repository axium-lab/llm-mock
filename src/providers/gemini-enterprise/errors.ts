import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../core/errors";
import { classicEnvelope } from "../google-shared/errors";

// Everything this provider serves today answers in the classic
// google.rpc.Status envelope. The Interactions API is the one surface that
// would bring the next-gen one along, and it is not mounted yet; when it is,
// this is where the split goes — see ../gemini/errors for the shape it takes.
const SERVICE = "aiplatform.googleapis.com";

export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json(
      classicEnvelope(404, `Unknown request URL: ${req.method} ${req.baseUrl}${req.path}`, null, SERVICE),
    );
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(classicEnvelope(err.status, err.message, err.code, SERVICE));
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json(classicEnvelope(500, message, null, SERVICE));
}
