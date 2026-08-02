import { approxTokens } from "../../../core/usage";
import type { MessageRequest, RequestBlock } from "../types";

function blockText(content: string | RequestBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (block?.type === "text" ? (block.text ?? "") : "")).join("");
}

// Counts what the prompt would cost before sending it. Unlike the messages
// endpoint this takes no `max_tokens` — there is no output to bound.
//
// The sum is built the same way /messages builds `usage.input_tokens`, one
// message at a time, so a client that counts first and then sends gets the
// same number back.
export function countTokens(request: MessageRequest): { input_tokens: number } {
  const messages = (request.messages ?? []).reduce(
    (sum, message) => sum + approxTokens(blockText(message.content)),
    0,
  );
  const system = request.system ? approxTokens(blockText(request.system)) : 0;
  // Tool declarations are billed as part of the prompt, so they count too.
  const tools = request.tools ? approxTokens(JSON.stringify(request.tools)) : 0;

  return { input_tokens: messages + system + tools };
}
