import type { Router } from "express";
import type { FixtureStore } from "../core/fixtures";

export interface ProviderDeps {
  apiKeys: Set<string>;
  fixtures: FixtureStore;
}

// A provider is a self-contained router mounted at /{name}. It owns its
// version segment (/v1, /v1beta, ...), its auth scheme, and its error
// envelope, so adding a provider never touches another one.
export interface Provider {
  name: string;
  createRouter(deps: ProviderDeps): Router;
}
