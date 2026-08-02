import type { Request } from "express";
import type { AuthScheme } from "../../core/auth";
import { ApiError } from "../../core/errors";

// Gemini takes the key in the x-goog-api-key header. The ?key= query parameter
// is the older form, still accepted by the real API and still emitted by some
// clients, and OAuth callers send a bearer token instead — all three are
// honored so a request only fails when the credential itself is unknown.
export const geminiAuthScheme: AuthScheme = {
  extractKey(req: Request): string | undefined {
    const header = req.headers["x-goog-api-key"];
    if (typeof header === "string" && header) return header;

    const query = req.query.key;
    if (typeof query === "string" && query) return query;

    const authorization = req.headers.authorization;
    return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  },
  // Google's API frontend rejects an unidentified caller before the service
  // ever sees the request, which is why this is a 403 and not a 401.
  missingKeyError(): ApiError {
    return new ApiError(
      403,
      "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.",
      "API_KEY_MISSING",
    );
  },
  // A key that is present but unknown is reported as a bad argument, not as an
  // authentication failure — the real API answers 400 INVALID_ARGUMENT here.
  invalidKeyError(_key: string): ApiError {
    return new ApiError(400, "API key not valid. Please pass a valid API key.", "API_KEY_INVALID");
  },
};
