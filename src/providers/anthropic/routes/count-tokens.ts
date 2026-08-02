import { Router } from "express";
import { ApiError } from "../../../core/errors";
import { countTokens } from "../services/count-tokens";
import type { MessageRequest } from "../types";

export const countTokensRouter = Router();

countTokensRouter.post("/", (req, res) => {
  const body = req.body as MessageRequest;
  if (typeof body?.model !== "string" || !body.model) {
    throw new ApiError(400, "model: Field required", "invalid_request_error");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ApiError(400, "messages: Input should be a valid list with at least 1 item", "invalid_request_error");
  }
  res.json(countTokens(body));
});
