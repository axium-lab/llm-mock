import type { Router } from "express";

export interface ProviderDeps {
  apiKeys: Set<string>;
}

// A provider is a self-contained router mounted at /{name}. It owns its
// version segment (/v1, /v1beta, ...), its auth scheme, and its error
// envelope, so adding a provider never touches another one.
export interface Provider {
  name: string;
  // Where SDK clients should point their baseURL, e.g. "/openai/v1".
  baseURLPath: string;
  createRouter(deps: ProviderDeps): Router;
}
