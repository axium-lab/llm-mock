import type { Request } from "express";
import type { AuthScheme } from "../../core/auth";
import { ApiError } from "../../core/errors";

// This platform authenticates two different ways, and the mock accepts both
// against the same api-keys.json set:
//
//   regional  — an OAuth 2 access token in Authorization: Bearer, obtained
//               from Application Default Credentials. This is how production
//               code calls it, and its URLs carry projects/{p}/locations/{l}.
//   express   — an API key in x-goog-api-key, no project or location in the
//               URL. Far easier to point at a mock, since the SDK skips ADC
//               entirely.
//
// A rejection differs by transport: a bad OAuth token is an authentication
// failure, while a bad API key is reported as a bad argument, exactly as on AI
// Studio.
export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

function apiKey(req: Request): string | undefined {
  const header = req.headers["x-goog-api-key"];
  if (typeof header === "string" && header) return header;
  const query = req.query.key;
  return typeof query === "string" && query ? query : undefined;
}

const UNAUTHENTICATED =
  "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie " +
  "or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.";

export const geminiEnterpriseAuthScheme: AuthScheme = {
  extractKey(req: Request): string | undefined {
    return bearerToken(req) ?? apiKey(req);
  },
  missingKeyError(): ApiError {
    return new ApiError(401, UNAUTHENTICATED, "UNAUTHENTICATED");
  },
  invalidKeyError(_key: string, req: Request): ApiError {
    if (bearerToken(req) !== undefined) {
      return new ApiError(401, UNAUTHENTICATED, "UNAUTHENTICATED");
    }
    return new ApiError(400, "API key not valid. Please pass a valid API key.", "API_KEY_INVALID");
  },
};
