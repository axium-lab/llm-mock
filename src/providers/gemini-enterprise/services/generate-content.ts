import { deterministicCreated } from "../../../core/ids";
import type { Overrides } from "../../../core/override";
import {
  buildGenerateContentChunks,
  buildGenerateContentResponse,
} from "../../google-shared/generate-content";
import type { GenerateContentRequest, GenerateContentResponse } from "../../google-shared/types";

// The generative contract is the one AI Studio serves, with a single addition:
// this platform stamps every response with a createTime. The SDK's own Vertex
// transformer reads exactly that field and nothing else beyond what AI Studio
// already sends, and it passes candidates through untouched.
export interface VertexGenerateContentResponse extends GenerateContentResponse {
  createTime: string;
}

// Derived from the response id rather than the clock, so identical requests
// stay byte-identical. Seconds precision, matching how the platform's sibling
// surfaces format their timestamps.
function createTimeFor(responseId: string): string {
  return `${new Date(deterministicCreated(responseId) * 1000).toISOString().slice(0, 19)}Z`;
}

function stamp(response: GenerateContentResponse): VertexGenerateContentResponse {
  return { ...response, createTime: createTimeFor(response.responseId) };
}

export function buildVertexGenerateContentResponse(
  model: string,
  request: GenerateContentRequest,
  overrides: Overrides = {},
): VertexGenerateContentResponse {
  return stamp(buildGenerateContentResponse(model, request, overrides));
}

export function buildVertexGenerateContentChunks(
  model: string,
  request: GenerateContentRequest,
  overrides: Overrides = {},
): VertexGenerateContentResponse[] {
  return buildGenerateContentChunks(model, request, overrides).map(stamp);
}
