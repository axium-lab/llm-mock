import { Router } from "express";
import { ApiError } from "../middleware/error-handler";
import { clearFixtures, registerFixture, type FixtureRule } from "../core/fixtures";

// Mock-only administration endpoints, outside the OpenAI contract.
export const mockAdminRouter = Router();

mockAdminRouter.post("/responses", (req, res) => {
  const rules = (Array.isArray(req.body) ? req.body : [req.body]) as FixtureRule[];
  for (const rule of rules) {
    if (typeof rule?.response?.content !== "string") {
      throw new ApiError(400, "Each fixture must have a 'response.content' string.", "invalid_request_error", null, "response.content");
    }
  }
  rules.forEach(registerFixture);
  res.status(201).json({ registered: rules.length });
});

mockAdminRouter.delete("/responses", (_req, res) => {
  clearFixtures();
  res.json({ cleared: true });
});
