import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import { createApp } from "../src/app";
import { loadApiKeys } from "../src/core/api-keys";

// First key from the committed api-keys.json.
export const VALID_API_KEY = "sk-mock-key-01";
// Documented known-invalid key for error-handling tests.
export const INVALID_API_KEY = "sk-mock-invalid";

export interface TestContext {
  server: Server;
  baseURL: string;
  client: OpenAI;
}

export async function startTestServer(): Promise<TestContext> {
  const app = createApp({ apiKeys: loadApiKeys("api-keys.json") });
  const server = await new Promise<Server>((resolve) => {
    const started: Server = app.listen(0, () => resolve(started));
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    server,
    baseURL: `${origin}/openai/v1`,
    client: new OpenAI({ apiKey: VALID_API_KEY, baseURL: `${origin}/openai/v1`, maxRetries: 0 }),
  };
}

export function stopTestServer(ctx: TestContext): Promise<void> {
  return new Promise((resolve, reject) => {
    ctx.server.close((error) => (error ? reject(error) : resolve()));
  });
}
