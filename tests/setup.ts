import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import { createApp } from "../src/app";
import { loadApiKeys } from "../src/core/api-keys";
import type { FixtureRule } from "../src/core/fixtures";

// First key from the committed api-keys.json.
export const VALID_API_KEY = "sk-mock-key-01";
// Documented known-invalid key for error-handling tests.
export const INVALID_API_KEY = "sk-mock-invalid";

export interface TestContext {
  server: Server;
  baseURL: string;
  mockURL: string;
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
    mockURL: `${origin}/__mock`,
    client: new OpenAI({ apiKey: VALID_API_KEY, baseURL: `${origin}/openai/v1`, maxRetries: 0 }),
  };
}

export function stopTestServer(ctx: TestContext): Promise<void> {
  return new Promise((resolve, reject) => {
    ctx.server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function registerFixture(ctx: TestContext, rule: FixtureRule): Promise<void> {
  const res = await fetch(`${ctx.mockURL}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error(`Failed to register fixture: ${res.status}`);
}

export async function clearFixtures(ctx: TestContext): Promise<void> {
  const res = await fetch(`${ctx.mockURL}/responses`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to clear fixtures: ${res.status}`);
}
