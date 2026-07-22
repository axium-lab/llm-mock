import express, { Router } from "express";
import { ApiError } from "../core/errors";
import type { FixtureRule, FixtureStore } from "../core/fixtures";

// Mock-only administration endpoints, outside any provider contract.
export function createMockAdminRouter(fixtures: FixtureStore): Router {
  const router = Router();
  router.use(express.json({ limit: "10mb" }));

  router.get("/fixtures", (_req, res) => {
    res.json({ fixtures: fixtures.list() });
  });

  router.post("/fixtures", (req, res) => {
    const rules = (Array.isArray(req.body) ? req.body : [req.body]) as FixtureRule[];
    for (const rule of rules) {
      if (typeof rule?.response?.content !== "string") {
        throw new ApiError(400, "Each fixture must have a 'response.content' string.", null, "response.content");
      }
    }
    for (const rule of rules) fixtures.register(rule);
    res.status(201).json({ registered: rules.length });
  });

  router.delete("/fixtures", (req, res) => {
    const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
    res.json({ cleared: fixtures.clear(provider) });
  });

  return router;
}
