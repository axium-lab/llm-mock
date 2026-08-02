import { ApiError } from "../../../core/errors";
import { decodeMetaId, deterministicCreated, encodeMetaId } from "../../../core/ids";
import { buildMessage } from "./messages";
import type { MessageRequest, RequestMessage } from "../types";

export const BATCH_ID_PREFIX = "msgbatch_";

// A batch is created by one request and read back by several others, which
// normally needs a store. The id carries the batch instead — the same
// metadata-in-the-id trick the Files endpoints use.
//
// Only what a result needs is encoded: the (c)ustom id, the (m)odel and the
// prompt (t)ext. Echoing a request's full body would make the id enormous for
// no gain, since the reply is an echo of the prompt either way.
interface EncodedRequest {
  c: string;
  m: string;
  t: string;
}

interface BatchMeta {
  r: EncodedRequest[];
  // Processing status, pinned at creation time.
  s: string;
}

// An id travels in the URL, so it cannot grow without bound. Real batches take
// up to 100,000 requests; this mock is much smaller, and says so loudly rather
// than truncating in silence.
const MAX_ID_LENGTH = 1600;

const PROCESSING_STATUSES = ["in_progress", "canceling", "ended"];

export interface BatchRequest {
  custom_id?: string;
  params?: MessageRequest;
}

export interface MessageBatch {
  id: string;
  type: "message_batch";
  processing_status: string;
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  created_at: string;
  expires_at: string;
  ended_at: string | null;
  archived_at: null;
  cancel_initiated_at: string | null;
  results_url: string | null;
}

function invalid(message: string): ApiError {
  return new ApiError(400, message, "invalid_request_error");
}

function firstUserText(messages: RequestMessage[] | undefined): string {
  for (const message of messages ?? []) {
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      const text = message.content.map((block) => (block?.type === "text" ? (block.text ?? "") : "")).join("");
      if (text) return text;
    }
  }
  return "";
}

function isoFrom(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
}

// Batch results stay available for 29 days after creation.
const LIFETIME_SECONDS = 29 * 24 * 60 * 60;

// `baseUrl` is where this mock's batches live, absolute. The SDK fetches
// `results_url` verbatim rather than resolving it against its own baseURL, so
// a path alone would be requested against the wrong origin.
function toBatch(id: string, meta: BatchMeta, baseUrl: string): MessageBatch {
  const created = deterministicCreated(id);
  const ended = meta.s === "ended";
  return {
    id,
    type: "message_batch",
    processing_status: meta.s,
    request_counts: {
      processing: ended ? 0 : meta.r.length,
      succeeded: ended ? meta.r.length : 0,
      errored: 0,
      canceled: 0,
      expired: 0,
    },
    created_at: isoFrom(created),
    expires_at: isoFrom(created + LIFETIME_SECONDS),
    ended_at: ended ? isoFrom(created) : null,
    archived_at: null,
    cancel_initiated_at: meta.s === "canceling" ? isoFrom(created) : null,
    // Only a finished batch has results to point at.
    results_url: ended ? `${baseUrl}/${id}/results` : null,
  };
}

// `status` comes from the x-llm-mock-batch-status header. A stateless mock has
// no clock to move a batch from in_progress to ended on its own, so a test
// that wants to exercise its polling branch pins the status it needs.
export function createBatch(requests: unknown, status: string | undefined, baseUrl: string): MessageBatch {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw invalid("requests: Input should be a valid list with at least 1 item");
  }
  if (status !== undefined && !PROCESSING_STATUSES.includes(status)) {
    throw invalid(
      `x-llm-mock-batch-status must be one of: ${PROCESSING_STATUSES.join(", ")}`,
    );
  }

  const seen = new Set<string>();
  const encoded: EncodedRequest[] = (requests as BatchRequest[]).map((request, index) => {
    const customId = request?.custom_id;
    if (typeof customId !== "string" || !customId) {
      throw invalid(`requests.${index}.custom_id: Field required`);
    }
    if (seen.has(customId)) {
      throw invalid(`requests.${index}.custom_id: ${customId} is duplicated`);
    }
    seen.add(customId);

    const params = request?.params;
    if (typeof params?.model !== "string" || !params.model) {
      throw invalid(`requests.${index}.params.model: Field required`);
    }
    return { c: customId, m: params.model, t: firstUserText(params.messages) };
  });

  const meta: BatchMeta = { r: encoded, s: status ?? "ended" };
  const id = encodeMetaId(BATCH_ID_PREFIX, meta);
  if (id.length > MAX_ID_LENGTH) {
    throw invalid(
      "This mock encodes a batch into its own id so it can stay stateless, which bounds how much a " +
        "batch can hold. Send fewer requests, or shorter prompts.",
    );
  }
  return toBatch(id, meta, baseUrl);
}

function decode(id: string): BatchMeta {
  const meta = decodeMetaId<BatchMeta>(BATCH_ID_PREFIX, id);
  if (!meta || !Array.isArray(meta.r) || typeof meta.s !== "string") {
    throw new ApiError(404, `message batch: ${id}`, "not_found_error");
  }
  return meta;
}

export function retrieveBatch(id: string, baseUrl: string): MessageBatch {
  return toBatch(id, decode(id), baseUrl);
}

// Cancelling moves a batch to `canceling`; the real API finishes in-flight
// requests before it settles.
export function cancelBatch(id: string, baseUrl: string): MessageBatch {
  const meta = decode(id);
  return toBatch(id, { ...meta, s: "canceling" }, baseUrl);
}

export function deleteBatch(id: string): { id: string; type: "message_batch_deleted" } {
  decode(id);
  return { id, type: "message_batch_deleted" };
}

// One JSON object per line, keyed by custom_id. Results arrive in request
// order here, but a client must never rely on that — the real API makes no
// ordering promise, which is why every result names its own custom_id.
export function batchResults(id: string): string {
  const meta = decode(id);
  if (meta.s !== "ended") {
    throw invalid(`Batch ${id} is not yet ready; its processing_status is ${meta.s}`);
  }

  return meta.r
    .map((entry) => {
      const message = buildMessage({
        model: entry.m,
        max_tokens: 1024,
        messages: entry.t ? [{ role: "user", content: entry.t }] : [],
      });
      return JSON.stringify({ custom_id: entry.c, result: { type: "succeeded", message } });
    })
    .join("\n");
}
