import type { Server } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { startServer, stopServer, VALID_API_KEY } from "../server";

export { INVALID_API_KEY, VALID_API_KEY } from "../server";

export const API_VERSION = "2023-06-01";

export interface TestContext {
  server: Server;
  // The SDK appends only the request path, so the version segment lives here.
  baseURL: string;
  client: Anthropic;
}

export async function startTestServer(): Promise<TestContext> {
  const { server, origin } = await startServer();
  const baseURL = `${origin}/anthropic`;
  return {
    server,
    baseURL,
    client: new Anthropic({ apiKey: VALID_API_KEY, baseURL, maxRetries: 0 }),
  };
}

export function stopTestServer(ctx: TestContext): Promise<void> {
  return stopServer(ctx.server);
}

// Every request needs both: the credential and the version header.
export function headers(key: string = VALID_API_KEY): Record<string, string> {
  return { "x-api-key": key, "anthropic-version": API_VERSION };
}
