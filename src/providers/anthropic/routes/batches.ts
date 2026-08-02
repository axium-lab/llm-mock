import { Router, type Request } from "express";
import { batchResults, cancelBatch, createBatch, deleteBatch, retrieveBatch } from "../services/batches";

export const batchesRouter = Router();

const STATUS_HEADER = "x-llm-mock-batch-status";

// Where this router is mounted, as an absolute URL, so a batch can hand back a
// `results_url` the SDK can fetch without resolving it against anything.
function batchesBase(req: Request): string {
  return `${req.protocol}://${req.get("host") ?? "localhost"}${req.baseUrl}`;
}

batchesRouter.post("/", (req, res) => {
  const body = req.body as { requests?: unknown };
  const pinned = req.headers[STATUS_HEADER];
  res.json(createBatch(body?.requests, typeof pinned === "string" ? pinned : undefined, batchesBase(req)));
});

// A stateless mock keeps no list of batches; the endpoint exists so a client
// that calls it gets an empty page rather than a 404.
batchesRouter.get("/", (_req, res) => {
  res.json({ data: [], has_more: false, first_id: null, last_id: null });
});

// Registered before /:id so the literal segment wins over the parameter.
batchesRouter.get("/:id/results", (req, res) => {
  // Built before the content type is set: a batch that is not ready throws,
  // and the error has to leave as JSON.
  const body = batchResults(req.params.id);
  res.type("application/x-jsonl").send(body);
});

batchesRouter.post("/:id/cancel", (req, res) => {
  res.json(cancelBatch(req.params.id, batchesBase(req)));
});

batchesRouter.get("/:id", (req, res) => {
  res.json(retrieveBatch(req.params.id, batchesBase(req)));
});

batchesRouter.delete("/:id", (req, res) => {
  res.json(deleteBatch(req.params.id));
});
