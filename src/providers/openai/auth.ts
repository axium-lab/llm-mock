import type { Request } from "express";
import type { AuthScheme } from "../../core/auth";
import { ApiError } from "../../core/errors";

// Mirrors how OpenAI masks the key in its 401 message.
function redactKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}****${key.slice(-4)}`;
}

export const openaiAuthScheme: AuthScheme = {
  extractKey(req: Request): string | undefined {
    const header = req.headers.authorization;
    return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  },
  missingKeyError(): ApiError {
    return new ApiError(
      401,
      "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY).",
    );
  },
  invalidKeyError(key: string): ApiError {
    return new ApiError(
      401,
      `Incorrect API key provided: ${redactKey(key)}. You can find your API key at https://platform.openai.com/account/api-keys.`,
      "invalid_api_key",
    );
  },
};
