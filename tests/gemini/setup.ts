import type { Server } from "node:http";
import { GoogleGenAI } from "@google/genai";
import { startServer, stopServer, VALID_API_KEY } from "../server";

export { INVALID_API_KEY, VALID_API_KEY } from "../server";

export interface TestContext {
  server: Server;
  // Bare provider prefix, without a version segment: the SDK appends that.
  baseUrl: string;
  client: GoogleGenAI;
}

export async function startTestServer(): Promise<TestContext> {
  const { server, origin } = await startServer();
  const baseUrl = `${origin}/gemini`;
  return {
    server,
    baseUrl,
    client: new GoogleGenAI({ apiKey: VALID_API_KEY, httpOptions: { baseUrl } }),
  };
}

export function stopTestServer(ctx: TestContext): Promise<void> {
  return stopServer(ctx.server);
}
