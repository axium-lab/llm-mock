import type { Request } from "express";
import type { AuthScheme } from "../../core/auth";
import { ApiError } from "../../core/errors";
import { AzureGatewayError } from "./errors";

// Azure takes the key in an `api-key` header rather than a bearer token —
// that is the single most common reason an OpenAI-shaped client fails against
// it. Entra ID callers send an OAuth token in `Authorization: Bearer` instead,
// and both are accepted here against the same api-keys.json set.
//
// The two failures answer differently, and that is Azure's own doing: a
// missing key is rejected by the API gateway, which knows nothing about the
// service's error envelope, while an invalid one gets the wrapped shape.
export const azureAuthScheme: AuthScheme = {
  extractKey(req: Request): string | undefined {
    const header = req.headers["api-key"];
    if (typeof header === "string" && header) return header;

    const authorization = req.headers.authorization;
    return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  },
  missingKeyError(): ApiError {
    return new AzureGatewayError(
      401,
      "Access denied due to missing subscription key. Make sure to include subscription key when making requests to an API.",
    );
  },
  invalidKeyError(): ApiError {
    return new ApiError(
      401,
      "Access denied due to invalid subscription key or wrong API endpoint. Make sure to provide a valid key for an active subscription and use a correct regional API endpoint for your resource.",
      "401",
    );
  },
};
