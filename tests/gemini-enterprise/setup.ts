import type { Server } from "node:http";
import { GoogleGenAI } from "@google/genai";
import { startServer, stopServer, VALID_API_KEY } from "../server";

export { INVALID_API_KEY, VALID_API_KEY } from "../server";

export interface TestContext {
  server: Server;
  // Bare provider prefix, without a version segment: the SDK appends that, and
  // in regional mode folds the project and location into it as well.
  baseUrl: string;
  // Authenticates with OAuth and addresses projects/{p}/locations/{l} paths.
  regional: GoogleGenAI;
  // Authenticates with an API key and addresses the publisher models directly.
  express: GoogleGenAI;
}

export const PROJECT = "llm-mock-project";
export const LOCATION = "europe-west1";

// In regional mode the SDK refuses to emit a request without Application
// Default Credentials, so a client pointed at a mock has to hand it something
// that answers like an auth client. This is the recipe the README documents.
function fakeAuthClient(token: string) {
  return {
    getRequestHeaders: async () => new Headers({ authorization: `Bearer ${token}` }),
    getAccessToken: async () => ({ token }),
    request: async () => ({ data: {} }),
  } as never;
}

export async function startTestServer(): Promise<TestContext> {
  const { server, origin } = await startServer();
  const baseUrl = `${origin}/gemini-enterprise`;
  return {
    server,
    baseUrl,
    regional: new GoogleGenAI({
      vertexai: true,
      project: PROJECT,
      location: LOCATION,
      httpOptions: { baseUrl },
      googleAuthOptions: { authClient: fakeAuthClient(VALID_API_KEY) },
    }),
    express: new GoogleGenAI({ vertexai: true, apiKey: VALID_API_KEY, httpOptions: { baseUrl } }),
  };
}

export function stopTestServer(ctx: TestContext): Promise<void> {
  return stopServer(ctx.server);
}
