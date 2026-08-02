<p align="center">
  <a href="https://llm-mock.dev">
    <img src="docs/og-image.png" alt="llm-mock — a self-hosted, OpenAI-compatible mock server. Change the baseURL, keep your code." width="820" />
  </a>
</p>

# llm-mock

[![CI](https://github.com/axium-lab/llm-mock/actions/workflows/ci.yml/badge.svg)](https://github.com/axium-lab/llm-mock/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/axium-lab/llm-mock)](https://github.com/axium-lab/llm-mock/releases)
[![Docker image](https://img.shields.io/badge/ghcr.io-axium--lab%2Fllm--mock-blue?logo=docker)](https://github.com/axium-lab/llm-mock/pkgs/container/llm-mock)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**A drop-in mock of LLM provider APIs for integration tests and open source projects. Change the `baseURL`, keep your code.**

> **⚡ Zero install** — a free hosted instance runs at **[`api.llm-mock.dev`](https://api.llm-mock.dev)**. Point your SDK's `baseURL` there and start testing in seconds; no download, no signup. [Details ↓](#hosted-instance)

Testing an app built on an LLM SDK usually means one of two things: paying for real API calls in CI, or leaking an API key into a place it should never be (a public repo, a contributor's laptop, a CI log). llm-mock removes that choice. It is a tiny local server that speaks each provider's API contract — same endpoints, same response shapes, same error format, same SSE streaming — but with deterministic, configurable responses and no real key required. OpenAI is supported today, Gemini (AI Studio) is landing now, and Anthropic and more are planned.

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

No mocking libraries, no request interception, no changes to your application code. The official `openai` SDK talks to llm-mock exactly as it talks to the real API — that compatibility is what the project's own test suite verifies.

## Hosted instance

Nothing to install: a free, shared instance runs at **`https://api.llm-mock.dev`**. Point any OpenAI SDK's `baseURL` at it and go:

```ts
const client = new OpenAI({
  baseURL: "https://api.llm-mock.dev/openai/v1",
  apiKey: "sk-mock-key-01",
});
```

It's a stateless mock meant for demos and CI — it holds no data and requires no signup, and it ships the same `sk-mock-key-01` … `sk-mock-key-10` keys. For custom keys, isolation, or offline use, run your own (below). See the full [API reference](https://llm-mock.dev/api.html).

## Features

- **OpenAI-compatible contract** — responses match the official API shapes, validated in CI with the official `openai` npm SDK as the client.
- **Streaming (SSE)** — `stream: true` works on chat completions (delta chunks + `data: [DONE]`) and on the Responses API (typed events: `response.created`, `response.output_text.delta`, `response.completed`, ...).
- **Deterministic and idempotent** — same request, same bytes: ids are content hashes, timestamps derive from them, embeddings are hash-seeded unit vectors. Snapshot-test friendly.
- **Stateless canned responses** — need a specific reply? Send it in the `x-llm-mock-response` header of the request itself. Nothing to register, nothing to clean up, and no server state: it behaves identically on a laptop, in CI, or behind a load balancer.
- **Tool calls** — `tool_choice: "required"` (or a named function) returns real `tool_calls` with arguments synthesized from your JSON Schema, streaming included; pin exact ones with the `x-llm-mock-tool-calls` header. The loop terminates once a tool result is in the conversation. [Details ↓](#tool-calls)
- **Files without a store** — `multipart/form-data` uploads and the chunked Uploads API work, yet nothing is persisted: the returned id carries the file's metadata, so `create` → `retrieve` round-trips on any instance. [Details ↓](#files-and-uploads)
- **Real error flows** — invalid API keys, unknown models, and validation errors return the exact OpenAI error envelope, so you can test your error handling too.
- **Zero setup** — clone, `bun install`, `bun start`. The valid API keys ship in the repo.

## Quick start

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/axium-lab/llm-mock.git
cd llm-mock
bun install
bun start
```

```
llm-mock listening on http://localhost:3000
- openai: baseURL http://localhost:3000/openai/v1
- gemini: baseURL http://localhost:3000/gemini
10 valid API keys loaded from api-keys.json
```

Then point any OpenAI SDK at it:

```ts
const client = new OpenAI({ baseURL: "http://localhost:3000/openai/v1", apiKey: "sk-mock-key-01" });
```

```python
client = OpenAI(base_url="http://localhost:3000/openai/v1", api_key="sk-mock-key-01")
```

```bash
curl http://localhost:3000/openai/v1/chat/completions \
  -H "Authorization: Bearer sk-mock-key-01" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "ping"}]}'
```

### Run with Docker

No Bun installed? A prebuilt multi-arch image (amd64/arm64) is published on [GHCR](https://github.com/axium-lab/llm-mock/pkgs/container/llm-mock) with every release:

```bash
docker run --rm -p 3000:3000 ghcr.io/axium-lab/llm-mock
```

Available tags: `latest`, and `X.Y.Z` / `X.Y` per release (pin a version in CI, e.g. `ghcr.io/axium-lab/llm-mock:0.1.0`).

Or build it yourself from the repo:

```bash
docker build -t llm-mock .
docker run --rm -p 3000:3000 llm-mock
```

To use your own API keys file, mount it over the default one:

```bash
docker run --rm -p 3000:3000 -v ./my-keys.json:/app/api-keys.json:ro llm-mock
```

The image ships a `HEALTHCHECK`, so orchestrators (and `docker compose` `depends_on: condition: service_healthy`) know when the mock is ready.

## Provider support

llm-mock is designed to be multi-provider: each provider mounts under its own URL prefix and implements its own API contract. This is where each one stands today:

| Provider | Prefix | Status |
| --- | --- | --- |
| OpenAI | `/openai/v1` | ✅ Supported |
| Gemini (AI Studio) | `/gemini` | 🚧 In progress — `generateContent`, Interactions API, files, streaming, tool calls, models |
| Anthropic | `/anthropic` | 🔜 Planned |
| Gemini Enterprise (Vertex AI) | — | 🔜 Planned |
| Azure OpenAI | — | 🔜 Planned |

Note that where the version segment lives depends on the SDK, not on us. The OpenAI client appends only the request path, so its `baseURL` carries the version; `@google/genai` appends the version itself, so its `baseUrl` stops at the provider prefix:

```ts
new OpenAI({ baseURL: "http://localhost:3000/openai/v1", apiKey: "sk-mock-key-01" });
new GoogleGenAI({ apiKey: "sk-mock-key-01", httpOptions: { baseUrl: "http://localhost:3000/gemini" } });
```

Want a provider prioritized? [Open an issue](https://github.com/axium-lab/llm-mock/issues) — or a PR (see [Contributing](#contributing)).

## Supported endpoints

### OpenAI

| Endpoint | Notes |
| --- | --- |
| `POST /openai/v1/chat/completions` | Full `chat.completion` object, `n` choices, SSE streaming, `stream_options.include_usage` |
| `POST /openai/v1/responses` | Full `response` object, typed SSE event stream |
| `GET /openai/v1/responses/{id}` | Stateless: synthesizes a deterministic response for any id |
| `DELETE /openai/v1/responses/{id}` | Idempotent; returns the OpenAI deletion object |
| `GET /openai/v1/models` | Simulated catalog (`gpt-4.1`, `gpt-4o`, `gpt-4o-mini`, `text-embedding-3-*`, ...) |
| `GET /openai/v1/models/{model}` | `404` in OpenAI error format for unknown models |
| `POST /openai/v1/embeddings` | Deterministic unit vectors, correct dimension per model, `dimensions` param, `float` and `base64` encoding |
| `POST /openai/v1/files` | `multipart/form-data` upload; validates `purpose`, honors `expires_after` |
| `GET /openai/v1/files` | Simulated catalog with `purpose` filter, `limit`, `order` and `after` pagination |
| `GET /openai/v1/files/{id}` | Stateless: the id carries the file's metadata, so an upload round-trips exactly |
| `DELETE /openai/v1/files/{id}` | Idempotent; returns the OpenAI deletion object |
| `GET /openai/v1/files/{id}/content` | Deterministic placeholder bytes (valid JSONL for `fine-tune`/`batch` files) |
| `POST /openai/v1/uploads` | Creates a `pending` upload for the chunked flow |
| `POST /openai/v1/uploads/{id}/parts` | Accepts a part of up to 64 MB, named or nameless |
| `POST /openai/v1/uploads/{id}/complete` | Returns the upload as `completed` with the nested `file` object |
| `POST /openai/v1/uploads/{id}/cancel` | Returns the upload as `cancelled` |

Parameters the mock does not simulate (`temperature`, `top_p`, `response_format`, ...) are accepted without error, because real SDK clients send them. `tools` and `tool_choice` **are** simulated — see [Tool calls](#tool-calls).

### Gemini (AI Studio)

Work in progress. Both `v1beta` and `v1` serve the same mock, so either `apiVersion` works.

| Endpoint | Notes |
| --- | --- |
| `POST /gemini/v1beta/models/{model}:generateContent` | Full response: `candidates`, `finishReason`, `usageMetadata` split by modality, `modelVersion`, `responseId`. `candidateCount`, `systemInstruction`, `tools` and `toolConfig` are simulated |
| `POST /gemini/v1beta/models/{model}:streamGenerateContent` | SSE with `?alt=sse`, streamed JSON array without it |
| `GET /gemini/v1beta/models` | Simulated catalog (`gemini-3.1-pro`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-embedding-001`, ...) |
| `GET /gemini/v1beta/models/{model}` | `404` in Google's `google.rpc.Status` format for unknown models |
| `GET /gemini/v1beta/tunedModels` | Always empty; this mock mints no tuned models |
| `POST /gemini/v1beta/interactions` | Interactions API: `steps`, `usage`, `status`, tool calls and SSE with `stream: true` |
| `GET /gemini/v1beta/interactions/{id}` | Stateless: synthesizes a deterministic interaction for any id. `?stream=true` replays it as events |
| `POST /gemini/v1beta/interactions/{id}/cancel` | Returns the interaction as `cancelled` |
| `DELETE /gemini/v1beta/interactions/{id}` | Idempotent; `200` with an empty body, which is what the SDK expects |
| `POST /gemini/upload/v1beta/files` | Resumable upload, both steps. Note the `upload/` segment sits **before** the version |
| `GET /gemini/v1beta/files` | Simulated catalog with `pageSize`/`pageToken` pagination |
| `GET /gemini/v1beta/files/{name}` | Stateless: the name carries the file's metadata, so an upload round-trips exactly |
| `DELETE /gemini/v1beta/files/{name}` | Idempotent; returns `{}` |

Custom methods are addressed the Google way, as `{resource}:{method}` — `models/gemini-3.6-flash:generateContent`. Those that are not implemented yet answer with the same `404` the real API returns for a method a model does not support.

```ts
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: "sk-mock-key-01",
  httpOptions: { baseUrl: "http://localhost:3000/gemini" },
});

const response = await ai.models.generateContent({ model: "gemini-3.6-flash", contents: "Hello!" });
console.log(response.text); // "Echo: Hello!"
```

The `x-llm-mock-response` and `x-llm-mock-tool-calls` headers work here exactly as they do on OpenAI. Two differences are Gemini's, not ours: `toolConfig.functionCallingConfig.mode` replaces `tool_choice` (`ANY` forces a call, `NONE` forbids one, `AUTO` leaves it to a model this mock does not have), and a call's arguments arrive as a decoded `args` object instead of a JSON string. A streamed call is never split across chunks.

#### Interactions API

Google's next-generation surface, GA since June 2026 and the one its own quickstart now uses. It is a different contract from `generateContent`, not a wrapper: fields are `snake_case`, a turn is a `Step` rather than a `Content`, and errors use the flatter envelope shown under [Authentication](#authentication).

```ts
const interaction = await ai.interactions.create({ model: "gemini-3.6-flash", input: "Hello!" });
console.log(interaction.output_text); // "Echo: Hello!"
```

The mock stays stateless here, exactly as it does on OpenAI's Responses API: `create` never stores anything, and `GET /interactions/{id}` synthesizes a deterministic interaction for whatever id you ask for instead of returning a `404`. So `store`, `background` and `previous_interaction_id` are accepted and ignored — a test that depends on real server-side continuation is the one thing this endpoint cannot fake.

Note that `tool_choice` lives inside `generation_config` on this surface, not beside `tools`. Streaming emits `interaction.created` → `step.start` / `step.delta` / `step.stop` → `interaction.completed`, and a function call's arguments arrive as `arguments_delta` pieces of a JSON string — the one place this API re-encodes what it otherwise sends decoded.

#### Files

The full resumable protocol works, and still nothing is persisted:

```ts
const file = await ai.files.upload({
  file: new Blob(["hello"], { type: "text/plain" }),
  config: { mimeType: "text/plain", displayName: "notes.txt" },
});

const same = await ai.files.get({ name: file.name });  // round-trips exactly
```

Both halves stay stateless. The upload session has no server-side table behind it: the metadata declared at `start` travels back to the client inside the `x-goog-upload-url` it is told to use, and returns with the bytes. The file's own metadata then rides inside the name it is given, so a later `get` answers accurately on any instance. `sha256Hash` is the genuine digest of the bytes received, so a client that verifies it succeeds.

That makes minted names longer than the 40 characters Google documents. The cap applies to names a *client* supplies, not to ones the server returns — verified against `@google/genai`, which reads a 90-character name back without complaint. Reserve the `files/missing…` prefix to exercise the not-found path, which the real API reports as a `403 PERMISSION_DENIED` rather than a `404`.

### Mock-only

| Endpoint | Notes |
| --- | --- |
| `GET /health` | Healthcheck, outside any provider contract |

## Authentication

llm-mock validates API keys against a closed set defined in [`api-keys.json`](api-keys.json), so you can test both the happy path and the failure path:

- **Valid keys**: `sk-mock-key-01` through `sk-mock-key-10` ship in the repo. Point the file somewhere else with `LLM_MOCK_API_KEYS_FILE` to use your own.
- **Invalid keys**: any other key — by convention use the documented `sk-mock-invalid`.

The key set is shared by every provider, so the same `sk-mock-key-01` works everywhere; what changes is **where the key travels** and **what a rejection looks like**, and both mirror the real provider.

OpenAI reads `Authorization: Bearer` and rejects with a `401`:

```json
{
  "error": {
    "message": "Incorrect API key provided: sk-moc****alid. You can find your API key at https://platform.openai.com/account/api-keys.",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

Gemini reads `x-goog-api-key` (with `?key=` and `Authorization: Bearer` also accepted, as the real API does) and reports a bad key as a `400`, not a `401`:

```json
{
  "error": {
    "code": 400,
    "message": "API key not valid. Please pass a valid API key.",
    "status": "INVALID_ARGUMENT",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "API_KEY_INVALID",
        "domain": "generativelanguage.googleapis.com",
        "metadata": { "service": "generativelanguage.googleapis.com" }
      }
    ]
  }
}
```

A Gemini request with no credential at all gets a `403 PERMISSION_DENIED` instead, which is what Google's API frontend answers to an unidentified caller.

## Controlling responses

By default every completion echoes the last user message (`"Echo: <your prompt>"`), which is deterministic and lets tests assert that their exact prompt reached the server. When a test needs a specific reply, the request itself carries it in a header — nothing to register beforehand, nothing to clean up afterwards:

```ts
const completion = await client.chat.completions.create(
  { model: "gpt-4o", messages: [{ role: "user", content: "What's the weather like?" }] },
  { headers: { "x-llm-mock-response": "It is sunny in Valencia." } },
);
// completion.choices[0].message.content === "It is sunny in Valencia."
```

```python
completion = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What's the weather like?"}],
    extra_headers={"x-llm-mock-response": "It is sunny in Valencia."},
)
```

HTTP headers cannot carry UTF-8 verbatim; for content beyond ASCII, base64-encode it into `x-llm-mock-response-base64` (which wins when both headers are present):

```ts
{ headers: { "x-llm-mock-response-base64": Buffer.from("Soleado — 30°C ☀️").toString("base64") } }
```

Because the canned response travels with the request, the server keeps no state at all: the same request always returns the same response, no matter which instance, replica, or restart serves it.

## Tool calls

The mock answers with tool calls in two situations, so an agent loop can be exercised end to end without a real model.

**1. `tool_choice` demands one.** With `"required"` the first declared tool is called; with `{ type: "function", function: { name } }` (Chat Completions) or `{ type: "function", name }` (Responses) that tool is called. `"auto"` and `"none"` answer with text, because deciding to call a tool is the one thing a mock cannot do. Arguments are synthesized from the tool's JSON Schema — `default` first, then the first `enum` value, then a placeholder per type — filling the `required` properties, or all of them when the schema declares no `required`.

```ts
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Weather in Valencia?" }],
  tools: [{ type: "function", function: { name: "get_weather", parameters: schema } }],
  tool_choice: "required",
});
// finish_reason === "tool_calls", message.content === null
// tool_calls[0].function === { name: "get_weather", arguments: '{"city":"mock","unit":"celsius"}' }
```

**2. The request pins them** in `x-llm-mock-tool-calls`, a JSON array (a bare object is taken as a single call) that overrides `tool_choice`. Omit `arguments` to have them synthesized from the schema; pass an object to encode it, or a string to send it verbatim — which is how you pin malformed arguments to test your own error handling:

```ts
const completion = await client.chat.completions.create(
  { model: "gpt-4o", messages: [{ role: "user", content: "Weather?" }] },
  {
    headers: {
      "x-llm-mock-tool-calls": JSON.stringify([
        { name: "get_weather", arguments: { city: "Valencia", unit: "celsius" } },
      ]),
    },
  },
);
```

Listing several entries produces parallel tool calls, each with its own id.

**The loop terminates.** Once the conversation carries a tool result — a `role: "tool"` message in Chat Completions, a `function_call_output` item in the Responses API — `tool_choice` stops forcing calls and the mock answers with text, so the second turn of an agent loop ends instead of calling the same tool forever. The explicit header still wins if you want a call anyway.

Both APIs stream tool calls too: Chat Completions emits `delta.tool_calls` pieces keyed by `index` and closes with `finish_reason: "tool_calls"`; the Responses API emits a `function_call` output item with `response.function_call_arguments.delta` / `.done` events. The Responses API also echoes the `tools` and `tool_choice` it received.

## Files and uploads

Files are the one part of the OpenAI contract that is inherently stateful, and llm-mock stores nothing. Instead of a server-side store, **the id carries the metadata**: `POST /files` encodes the filename, size and purpose into the id it returns, so a later `retrieve` answers accurately without anything having been kept — on any instance, after any restart.

```ts
const file = await client.files.create({
  file: await toFile(Buffer.from('{"prompt":"hi"}\n'), "training.jsonl"),
  purpose: "fine-tune",
});
// file.filename === "training.jsonl", file.bytes === 16

const same = await client.files.retrieve(file.id); // identical object, no state involved
```

The chunked [Uploads API](https://platform.openai.com/docs/api-reference/uploads) works the same way, so `complete` echoes back what `create` was told:

```ts
const upload = await client.uploads.create({
  filename: "training-examples.jsonl",
  bytes: 2048,
  mime_type: "text/jsonl",
  purpose: "fine-tune",
});
const part = await client.uploads.parts.create(upload.id, { data: new Blob([chunk]) });
const done = await client.uploads.complete(upload.id, { part_ids: [part.id] });
// done.status === "completed", done.file.filename === "training-examples.jsonl"
```

What this costs, and how to work with it:

- **Uploads do not appear in `GET /files`.** That endpoint returns a fixed simulated catalog — `file-mock-training-jsonl`, `file-mock-validation-jsonl`, `file-mock-manual-pdf`, `file-mock-batch-input`, `file-mock-diagram-png` — the same way `GET /models` returns a fixed model catalog. Use it to exercise listing, the `purpose` filter and `limit`/`after` pagination.
- **`GET /files/{id}/content` returns placeholder bytes**, not what you uploaded: valid JSONL for `fine-tune`/`batch` files, a text marker otherwise. To pin exact bytes, send them in `x-llm-mock-response` on the content request.
- **Any well-formed id resolves.** Since the mock cannot know what exists, ids it did not mint get plausible synthetic metadata. To test a 404, use a reserved id: anything starting with `file-missing` or `upload_missing` is always reported as not found, just like the known-invalid `sk-mock-invalid` API key.
- **Deletion is idempotent** and always reports `deleted: true`; there is nothing to remove.

## Configuration

Everything is optional — llm-mock works out of the box. To override the defaults, set environment variables or copy [`.env.example`](.env.example) to `.env` (Bun loads it automatically, no dotenv needed).

| Environment variable | Default | Description |
| --- | --- | --- |
| `LLM_MOCK_PORT` (or `PORT`) | `3000` | Port to listen on |
| `LLM_MOCK_API_KEYS_FILE` | `api-keys.json` | Path to the JSON array of valid API keys |

## Using it in your test suite

Import the app factory directly and mount it on an ephemeral port — no separate process needed. This is exactly how llm-mock tests itself:

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
bun test           # integration tests (official openai SDK as the client)
bun run typecheck  # tsc --noEmit
```

Stack: [Bun](https://bun.sh) + TypeScript + [Express](https://expressjs.com). The server holds no state — identical requests produce identical responses across restarts and replicas.

## Contributing

Issues and PRs are welcome. The one hard rule: every endpoint must keep working against the official `openai` SDK — add or extend an integration test in [`tests/`](tests/) that proves it.

## License

[MIT](LICENSE)
