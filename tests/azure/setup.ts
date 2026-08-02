import type { Server } from "node:http";
import OpenAI, { AzureOpenAI } from "openai";
import { startServer, stopServer, VALID_API_KEY } from "../server";

export { INVALID_API_KEY, VALID_API_KEY } from "../server";

export const API_VERSION = "2024-10-21";

export interface TestContext {
  server: Server;
  // Everything under /azure/openai, which is where the resource's own path
  // would begin on a real Azure endpoint.
  baseUrl: string;
  // Deployment-based surface: ?api-version= on every call, api-key auth.
  classic: AzureOpenAI;
  // The v1 surface: OpenAI's contract verbatim.
  v1: OpenAI;
}

export async function startTestServer(): Promise<TestContext> {
  const { server, origin } = await startServer();
  const baseUrl = `${origin}/azure/openai`;
  return {
    server,
    baseUrl,
    // `baseURL` rather than `endpoint`: the SDK reads OPENAI_BASE_URL from the
    // environment and then refuses to combine it with `endpoint`, which would
    // make these tests depend on whatever .env happens to be present.
    classic: new AzureOpenAI({ baseURL: baseUrl, apiKey: VALID_API_KEY, apiVersion: API_VERSION }),
    v1: new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: VALID_API_KEY, maxRetries: 0 }),
  };
}

export function stopTestServer(ctx: TestContext): Promise<void> {
  return stopServer(ctx.server);
}
