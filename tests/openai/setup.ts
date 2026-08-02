import type { Server } from "node:http";
import OpenAI from "openai";
import { startServer, stopServer, VALID_API_KEY } from "../server";

export { INVALID_API_KEY, VALID_API_KEY } from "../server";

export interface TestContext {
  server: Server;
  baseURL: string;
  client: OpenAI;
}

export async function startTestServer(): Promise<TestContext> {
  const { server, origin } = await startServer();
  const baseURL = `${origin}/openai/v1`;
  return {
    server,
    baseURL,
    client: new OpenAI({ apiKey: VALID_API_KEY, baseURL, maxRetries: 0 }),
  };
}

export function stopTestServer(ctx: TestContext): Promise<void> {
  return stopServer(ctx.server);
}
