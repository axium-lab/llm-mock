import type { Router } from "express";

export interface ProviderDeps {
  apiKeys: Set<string>;
}

// A provider is a self-contained router mounted at /{name}. It owns its
// version segment (/v1, /v1beta, ...), its auth scheme, and its error
// envelope, so adding a provider never touches another one.
export interface Provider {
  name: string;
  // Where SDK clients should point their baseURL. Whether it carries the
  // version segment depends on the SDK: the OpenAI client appends only the
  // request path ("/openai/v1"), while @google/genai appends the version too
  // ("/gemini").
  baseURLPath: string;
  createRouter(deps: ProviderDeps): Router;
}
