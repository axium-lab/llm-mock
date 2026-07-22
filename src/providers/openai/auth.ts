import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../middleware/error-handler";

// Mirrors how OpenAI masks the key in its 401 message.
function redactKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}****${key.slice(-4)}`;
}

export function createAuthMiddleware(validKeys: Set<string>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const key = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    if (!key) {
      throw new ApiError(
        401,
        "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY).",
        "invalid_request_error",
        null,
      );
    }
    if (!validKeys.has(key)) {
      throw new ApiError(
        401,
        `Incorrect API key provided: ${redactKey(key)}. You can find your API key at https://platform.openai.com/account/api-keys.`,
        "invalid_request_error",
        "invalid_api_key",
      );
    }
    next();
  };
}
