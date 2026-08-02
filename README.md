<p align="center">
  <a href="https://llm-mock.dev">
    <img src="docs/og-image.png" alt="llm-mock — test your LLM integrations without exposing your API key. A self-hosted, multi-provider mock server: OpenAI, Anthropic, Gemini, Gemini Enterprise and Azure. Zero install, deterministic, SSE streaming." width="820" />
  </a>
</p>

# llm-mock

[![CI](https://github.com/axium-lab/llm-mock/actions/workflows/ci.yml/badge.svg)](https://github.com/axium-lab/llm-mock/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/axium-lab/llm-mock)](https://github.com/axium-lab/llm-mock/releases)
[![Docker image](https://img.shields.io/badge/ghcr.io-axium--lab%2Fllm--mock-blue?logo=docker)](https://github.com/axium-lab/llm-mock/pkgs/container/llm-mock)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**A drop-in mock of LLM provider APIs for integration tests and open source projects. Change the `baseURL`, keep your code.**

Testing an app built on an LLM SDK usually means paying for real API calls in CI, or leaking a key into a place it should never be. llm-mock removes that choice: a tiny local server that speaks each provider's contract — same endpoints, same response shapes, same errors, same SSE streaming — with deterministic replies and no real key.

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/openai/v1", // the only change in your app
  apiKey: "sk-mock-key-01",                   // any key from api-keys.json
});

const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(completion.choices[0].message.content); // "Echo: Hello!"
```

No mocking libraries, no request interception, no changes to your application code. The official SDKs talk to llm-mock exactly as they talk to the real API — that compatibility is what the test suite verifies, with those SDKs as the clients.

> **⚡ Zero install** — a free hosted instance runs at **[`api.llm-mock.dev`](https://api.llm-mock.dev)**. Point your SDK there and start in seconds; no download, no signup.

**📖 [Full API reference at llm-mock.dev](https://llm-mock.dev/api.html)** — every endpoint, header, error shape and quirk, one page per provider.

## Why

- **Faithful, not a stub.** Responses match each provider's real shapes, validated in CI against the official `openai`, `@anthropic-ai/sdk` and `@google/genai` SDKs.
- **Deterministic.** Same request, same bytes: ids are content hashes, timestamps derive from them, embeddings are hash-seeded unit vectors. Snapshot-test friendly.
- **Stateless, always.** No store, no cleanup, no ordering between tests. It behaves identically on a laptop, in CI, or behind a load balancer — even for files and batches, whose ids carry their own metadata.
- **Controllable.** Need a specific reply? Send it in a request header. Nothing to register beforehand, nothing to tear down after.
- **The failure paths too.** Invalid keys, unknown models, validation errors and content filters return each provider's exact error envelope, so your error handling gets tested as well.
- **Zero setup.** One Docker command, or `bun install && bun start`. The valid keys ship in the repo.

## Providers

Each provider mounts under its own prefix and implements its own contract — its own auth scheme, its own error envelope, its own streaming convention.

| Provider | Prefix | Reference |
| --- | --- | --- |
| OpenAI | `/openai/v1` | [Docs →](https://llm-mock.dev/api-openai.html) |
| Anthropic | `/anthropic` | [Docs →](https://llm-mock.dev/api-anthropic.html) |
| Gemini (AI Studio) | `/gemini` | [Docs →](https://llm-mock.dev/api-gemini.html) |
| Gemini Enterprise (ex-Vertex AI) | `/gemini-enterprise` | [Docs →](https://llm-mock.dev/api-gemini-enterprise.html) |
| Azure OpenAI | `/azure/openai` | [Docs →](https://llm-mock.dev/api-azure.html) |

Between them: chat completions and the Responses API, Anthropic's Messages API with content blocks and thinking, `generateContent` and the Interactions API, tool calls, embeddings, files and uploads, message batches, token counting, content filtering, and SSE streaming in all three conventions the five providers use.

Where the version segment lives depends on the SDK, not on us — the OpenAI and Anthropic clients append only the request path, so their `baseURL` carries the version, while `@google/genai` appends the version itself:

```ts
new OpenAI({ baseURL: "http://localhost:3000/openai/v1", apiKey: "sk-mock-key-01" });
new Anthropic({ baseURL: "http://localhost:3000/anthropic", apiKey: "sk-mock-key-01" });
new GoogleGenAI({ apiKey: "sk-mock-key-01", httpOptions: { baseUrl: "http://localhost:3000/gemini" } });
```

Want a provider prioritized? [Open an issue](https://github.com/axium-lab/llm-mock/issues) — or a PR.

## Quick start

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/axium-lab/llm-mock.git
cd llm-mock
bun install
bun start
```

Or with Docker — a prebuilt multi-arch image (amd64/arm64) is published on [GHCR](https://github.com/axium-lab/llm-mock/pkgs/container/llm-mock) with every release:

```bash
docker run --rm -p 3000:3000 ghcr.io/axium-lab/llm-mock
```

Tags: `latest`, plus `X.Y.Z` / `X.Y` per release — pin a version in CI. To use your own keys, mount the file over the default: `-v ./my-keys.json:/app/api-keys.json:ro`. The image ships a `HEALTHCHECK`, so `docker compose`'s `depends_on: condition: service_healthy` knows when it is ready.

Then point any SDK at it:

```python
client = OpenAI(base_url="http://localhost:3000/openai/v1", api_key="sk-mock-key-01")
```

```bash
curl http://localhost:3000/openai/v1/chat/completions \
  -H "Authorization: Bearer sk-mock-key-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "ping"}]}'
```

## Controlling responses

Every completion echoes the last user message by default (`"Echo: <your prompt>"`), which is deterministic and lets a test assert that its exact prompt reached the server. When a test needs a specific reply, the request carries it:

```ts
const completion = await client.chat.completions.create(
  { model: "gpt-4o", messages: [{ role: "user", content: "What's the weather like?" }] },
  { headers: { "x-llm-mock-response": "It is sunny in Valencia." } },
);
// completion.choices[0].message.content === "It is sunny in Valencia."
```

| Header | Purpose |
| --- | --- |
| `x-llm-mock-response` | ASCII reply, returned verbatim |
| `x-llm-mock-response-base64` | Base64 reply, for content beyond ASCII. Wins when both are present. |
| `x-llm-mock-tool-calls` | JSON array of tool calls the reply must contain, overriding `tool_choice` |
| `x-llm-mock-content-filter` | Azure only — pins the content-filter verdict |
| `x-llm-mock-batch-status` | Anthropic only — pins a batch's `processing_status` |

Because the canned response travels **with the request**, the server keeps no state: the same request returns the same bytes, whichever instance or replica serves it. [More on response control →](https://llm-mock.dev/api.html#control)

## Authentication

Keys are validated against a closed set in [`api-keys.json`](api-keys.json), so both the happy path and the failure path are testable:

- **Valid**: `sk-mock-key-01` … `sk-mock-key-10`, shipped in the repo. Point `LLM_MOCK_API_KEYS_FILE` elsewhere for your own.
- **Invalid**: any other key — by convention, the documented `sk-mock-invalid`.

One key set serves every provider. What changes is **where the credential travels** and **what a rejection looks like**, and both mirror the real service — OpenAI's `Authorization: Bearer` and `401`, Anthropic's `x-api-key`, Google's `x-goog-api-key` and its `400` for a bad key. [Full table of auth schemes and rejection shapes →](https://llm-mock.dev/api.html#auth)

## Configuration

Everything is optional — llm-mock works out of the box. Set environment variables, or copy [`.env.example`](.env.example) to `.env` (Bun loads it automatically).

| Environment variable | Default | Description |
| --- | --- | --- |
| `LLM_MOCK_PORT` (or `PORT`) | `3000` | Port to listen on |
| `LLM_MOCK_API_KEYS_FILE` | `api-keys.json` | Path to the JSON array of valid API keys |

## Using it in your test suite

Import the app factory and mount it on an ephemeral port — no separate process. This is exactly how llm-mock tests itself:

```ts
import OpenAI from "openai";
import { createApp } from "llm-mock/src/app";
import { loadApiKeys } from "llm-mock/src/core/api-keys";

const server = createApp({ apiKeys: loadApiKeys("api-keys.json") }).listen(0);
const { port } = server.address();
const client = new OpenAI({ apiKey: "sk-mock-key-01", baseURL: `http://127.0.0.1:${port}/openai/v1` });
```

## Development

```bash
bun run dev        # start with file watching
bun test           # integration tests, with the official SDKs as the clients
bun run typecheck  # tsc --noEmit
```

Stack: [Bun](https://bun.sh) + TypeScript + [Express](https://expressjs.com). Each provider is a self-contained router under `src/providers/`, sharing `src/core/`. The server holds no state — identical requests produce identical responses across restarts and replicas.

## Contributing

Issues and PRs are welcome. The one hard rule: every endpoint must keep working against its provider's official SDK — add or extend an integration test in [`tests/`](tests/) that proves it.

## License

[MIT](LICENSE)
