// Google ships two error envelopes, and both of its Gemini surfaces use them.
//
//   classic — the google.rpc.Status envelope shared by every Google Cloud API:
//     { "error": { "code": 400, "message", "status": "INVALID_ARGUMENT",
//                  "details": [ ... ] } }
//
//   next-gen — a flatter, OpenAI-looking envelope introduced with the
//   Interactions API:
//     { "error": { "code": "invalid_request", "message" } }
//
// Which one applies depends on the path, and each provider decides that for
// itself: the surfaces do not sit at the same URLs. What is shared is how each
// envelope is built, and the vocabulary of statuses and codes.

export const RPC_STATUS: Record<number, string> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  429: "RESOURCE_EXHAUSTED",
  499: "CANCELLED",
  500: "INTERNAL",
  503: "UNAVAILABLE",
};

export const NEXT_GEN_CODE: Record<number, string> = {
  400: "invalid_request",
  401: "authentication",
  403: "permission_denied",
  404: "not_found",
  429: "rate_limit_exceeded",
  499: "cancelled",
  500: "api_error",
  503: "service_unavailable",
};

// Credentials are checked by Google's API frontend, which sits ahead of every
// service and answers in the classic envelope on all of them — including
// surfaces whose own errors use the next-gen one. Verified against the live AI
// Studio API: a bad key on /interactions comes back as google.rpc.Status.
export const FRONTEND_REASONS = new Set([
  "API_KEY_INVALID",
  "API_KEY_MISSING",
  "REQUESTED_ENTITY_NOT_FOUND",
  "UNAUTHENTICATED",
]);

// Only an invalid API key carries details; every other error observed on the
// live API — missing credential, unknown model, unknown file, a malformed
// request body — reports code/message/status and nothing else.
function detailsFor(reason: string | null, message: string, service: string) {
  if (reason !== "API_KEY_INVALID") return {};
  return {
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason,
        domain: "googleapis.com",
        metadata: { service },
      },
      { "@type": "type.googleapis.com/google.rpc.LocalizedMessage", locale: "en-US", message },
    ],
  };
}

export function classicEnvelope(status: number, message: string, reason: string | null, service: string) {
  return {
    error: {
      code: status,
      message,
      status: RPC_STATUS[status] ?? "UNKNOWN",
      ...detailsFor(reason, message, service),
    },
  };
}

export function nextGenEnvelope(status: number, message: string) {
  return { error: { code: NEXT_GEN_CODE[status] ?? "api_error", message } };
}

export function isFrontendFailure(reason: string | null): boolean {
  return reason !== null && FRONTEND_REASONS.has(reason);
}
