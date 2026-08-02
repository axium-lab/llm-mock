import { chunkText } from "../../../core/sse";
import type { ContentBlock, Message } from "../types";

// Anthropic's stream is the one here that uses *named* SSE events: each frame
// carries an `event:` line as well as `data:`, and the SDK sees nothing at all
// without it. It also has no sentinel string — the stream ends on a named
// `message_stop`, and a stream that just closes is rejected as never having
// produced a message.
export interface StreamEvent {
  name: string;
  data: Record<string, unknown>;
}

// A block is announced empty, filled by deltas, then closed. Text and thinking
// stream their prose; a tool call streams its arguments back as a JSON string —
// the one place this API re-encodes what it otherwise sends decoded.
function blockEvents(block: ContentBlock, index: number): StreamEvent[] {
  const start = (content_block: unknown): StreamEvent => ({
    name: "content_block_start",
    data: { type: "content_block_start", index, content_block },
  });
  const delta = (value: Record<string, unknown>): StreamEvent => ({
    name: "content_block_delta",
    data: { type: "content_block_delta", index, delta: value },
  });
  const stop: StreamEvent = { name: "content_block_stop", data: { type: "content_block_stop", index } };

  if (block.type === "text") {
    return [
      start({ type: "text", text: "", citations: null }),
      ...chunkText(block.text).map((text) => delta({ type: "text_delta", text })),
      stop,
    ];
  }

  if (block.type === "thinking") {
    return [
      start({ type: "thinking", thinking: "", signature: "" }),
      ...chunkText(block.thinking).map((thinking) => delta({ type: "thinking_delta", thinking })),
      // The signature arrives as its own delta type, after the reasoning.
      delta({ type: "signature_delta", signature: block.signature }),
      stop,
    ];
  }

  return [
    start({ type: "tool_use", id: block.id, name: block.name, input: {} }),
    ...chunkText(JSON.stringify(block.input)).map((partial_json) =>
      delta({ type: "input_json_delta", partial_json }),
    ),
    stop,
  ];
}

export function buildMessageEvents(message: Message): StreamEvent[] {
  return [
    {
      name: "message_start",
      data: {
        type: "message_start",
        message: {
          id: message.id,
          type: "message",
          role: "assistant",
          model: message.model,
          // The opening frame carries no content and no verdict yet.
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: message.usage.input_tokens, output_tokens: 0 },
        },
      },
    },
    ...message.content.flatMap(blockEvents),
    {
      name: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: message.stop_reason, stop_sequence: message.stop_sequence },
        usage: { output_tokens: message.usage.output_tokens },
      },
    },
    { name: "message_stop", data: { type: "message_stop" } },
  ];
}
