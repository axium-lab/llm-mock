import { ApiError } from "../../core/errors";
import { approxTokens } from "../../core/usage";
import type { CountTokensRequest, CountTokensResponse, GenerateContentRequest } from "./types";
import { normalizeContents } from "./generate-content";

// countTokens takes either a bare `contents` list or a whole
// `generateContentRequest`, which is how a caller measures a prompt with its
// system instruction and tool declarations included.
function subject(body: CountTokensRequest): GenerateContentRequest {
  if (body?.generateContentRequest) return body.generateContentRequest;
  return { contents: body?.contents };
}

function textOf(request: GenerateContentRequest): string {
  const contents = normalizeContents(request.contents);
  const turns = contents.map((content) => (content.parts ?? []).map((part) => part.text ?? "").join("")).join("");

  const instruction =
    typeof request.systemInstruction === "string"
      ? request.systemInstruction
      : (request.systemInstruction?.parts ?? []).map((part) => part.text ?? "").join("");

  // Tool declarations are billed as part of the prompt, so they count too.
  const tools = request.tools ? JSON.stringify(request.tools) : "";
  return turns + instruction + tools;
}

export function countTokens(body: CountTokensRequest): CountTokensResponse {
  const request = subject(body);
  if (normalizeContents(request.contents).length === 0) {
    throw new ApiError(400, "* CountTokensRequest.contents: contents is not specified\n", "INVALID_ARGUMENT");
  }

  const totalTokens = approxTokens(textOf(request));
  return {
    totalTokens,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: totalTokens }],
  };
}
