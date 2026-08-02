import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { startServer, stopServer, type RunningServer } from "./server";

// /health belongs to no provider contract: it is the mock's own endpoint,
// so it is tested against plain fetch rather than through an SDK.
describe("health", () => {
  let running: RunningServer;
  beforeAll(async () => {
    running = await startServer();
  });
  afterAll(() => stopServer(running.server));

  it("reports the status and the running version", async () => {
    const res = await fetch(`${running.origin}/health`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ status: "ok", version: pkg.version });
  });

  it("needs no API key", async () => {
    const res = await fetch(`${running.origin}/health`);
    expect(res.status).toBe(200);
  });
});
