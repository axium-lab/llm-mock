import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import { loadApiKeys } from "../src/core/api-keys";

// First key from the committed api-keys.json. The key set is shared by every
// provider, so the same value authenticates against /openai and /gemini alike.
export const VALID_API_KEY = "sk-mock-key-01";
// Documented known-invalid key for error-handling tests.
export const INVALID_API_KEY = "sk-mock-invalid";

export interface RunningServer {
  server: Server;
  origin: string;
}

// Mounts the app on an ephemeral port. Each provider's setup builds its own
// SDK client on top of the returned origin.
export async function startServer(): Promise<RunningServer> {
  const app = createApp({ apiKeys: loadApiKeys("api-keys.json") });
  const server = await new Promise<Server>((resolve) => {
    const started: Server = app.listen(0, () => resolve(started));
  });
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

export function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
