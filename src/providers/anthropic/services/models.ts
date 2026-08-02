import { ApiError } from "../../../core/errors";
import type { Model, ModelList, ModelListQuery } from "../types";

const MAX_LIMIT = 1000;

// Every current model reports the same capability tree except for the effort
// ceiling and thinking support, so it is built rather than repeated.
function capabilities(options: { effortMax: boolean; thinking: boolean }): Record<string, unknown> {
  const supported = { supported: true };
  return {
    image_input: supported,
    structured_outputs: supported,
    thinking: {
      supported: options.thinking,
      types: {
        // Manual budgets are gone on the current generation; adaptive replaced them.
        enabled: { supported: false },
        adaptive: { supported: options.thinking },
      },
    },
    effort: {
      supported: true,
      low: supported,
      medium: supported,
      high: supported,
      xhigh: supported,
      max: { supported: options.effortMax },
    },
    context_management: { compact_20260112: supported },
  };
}

function entry(
  id: string,
  display_name: string,
  created_at: string,
  max_input_tokens: number,
  max_tokens: number,
  options: { effortMax: boolean; thinking: boolean } = { effortMax: true, thinking: true },
): Model {
  return {
    type: "model",
    id,
    display_name,
    created_at,
    max_input_tokens,
    max_tokens,
    capabilities: capabilities(options),
  };
}

// Simulated catalog. `created_at` values are fixed so the listing is
// byte-identical on every call.
const CATALOG: Model[] = [
  entry("claude-fable-5", "Claude Fable 5", "2026-06-24T00:00:00Z", 1_000_000, 128_000),
  entry("claude-opus-5", "Claude Opus 5", "2026-05-20T00:00:00Z", 1_000_000, 128_000),
  entry("claude-opus-4-8", "Claude Opus 4.8", "2026-02-10T00:00:00Z", 1_000_000, 128_000),
  entry("claude-sonnet-5", "Claude Sonnet 5", "2026-04-15T00:00:00Z", 1_000_000, 128_000),
  entry("claude-haiku-4-5", "Claude Haiku 4.5", "2025-10-01T00:00:00Z", 200_000, 64_000, {
    effortMax: false,
    thinking: false,
  }),
];

export function getModel(id: string): Model | undefined {
  return CATALOG.find((model) => model.id === id);
}

export function modelNotFound(id: string): ApiError {
  return new ApiError(404, `model: ${id}`, "not_found_error");
}

// Cursor pagination by id: `after_id` and `before_id` name a model, not an
// offset, and the response reports the ids bounding the page.
export function listModels(query: ModelListQuery): ModelList {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ApiError(
      400,
      `limit: must be a positive integer no greater than ${MAX_LIMIT}`,
      "invalid_request_error",
    );
  }

  let models = CATALOG;
  if (query.after_id !== undefined) {
    const cursor = models.findIndex((model) => model.id === query.after_id);
    models = cursor === -1 ? [] : models.slice(cursor + 1);
  }
  if (query.before_id !== undefined) {
    const cursor = models.findIndex((model) => model.id === query.before_id);
    models = cursor === -1 ? [] : models.slice(0, cursor);
  }

  const page = models.slice(0, limit);
  return {
    data: page,
    has_more: models.length > page.length,
    first_id: page[0]?.id ?? null,
    last_id: page[page.length - 1]?.id ?? null,
  };
}
