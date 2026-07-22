import type { Response } from "express";

export function openSSE(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

export function sendEvent(res: Response, data: unknown, event?: string): void {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Chat Completions streams terminate with a literal [DONE] sentinel.
export function sendDone(res: Response): void {
  res.write("data: [DONE]\n\n");
  res.end();
}

// Split text into small pieces to simulate real token-by-token streaming.
export function chunkText(text: string, size = 8): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    pieces.push(text.slice(i, i + size));
  }
  return pieces.length > 0 ? pieces : [""];
}
