import express, { Router } from "express";
import { ApiError } from "../core/errors";
import { clearFixtures, registerFixture, type FixtureRule } from "../core/fixtures";

// Mock-only administration endpoints, outside the OpenAI contract.
export const mockAdminRouter = Router();
mockAdminRouter.use(express.json({ limit: "10mb" }));

mockAdminRouter.post("/responses", (req, res) => {
  const rules = (Array.isArray(req.body) ? req.body : [req.body]) as FixtureRule[];
  for (const rule of rules) {
    if (typeof rule?.response?.content !== "string") {
      throw new ApiError(400, "Each fixture must have a 'response.content' string.", null, "response.content");
    }
  }
  rules.forEach(registerFixture);
  res.status(201).json({ registered: rules.length });
});

mockAdminRouter.delete("/responses", (_req, res) => {
  clearFixtures();
  res.json({ cleared: true });
});
