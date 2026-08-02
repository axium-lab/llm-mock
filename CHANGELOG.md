# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-08-02

### Added

- Gemini (AI Studio) provider mounted at `/gemini`, served on both `v1beta` and `v1`: model catalog (`GET /models`, `GET /models/{model}`, empty `GET /tunedModels`), validated against the official `@google/genai` SDK.
- `POST /gemini/v1beta/models/{model}:generateContent`, with `candidates`, `finishReason`, `usageMetadata` split by modality, `modelVersion` and `responseId`, honoring `candidateCount` and counting `systemInstruction` towards the prompt tokens.
- `POST /gemini/v1beta/models/{model}:streamGenerateContent`: SSE with `?alt=sse` and a streamed JSON array without it. No `[DONE]` sentinel, which the Gemini SDK would reject as an incomplete JSON segment.
- Gemini Enterprise provider (the platform formerly called Vertex AI) mounted at `/gemini-enterprise`, on both `v1beta1` and `v1`: publisher model catalog under `publisherModels`, served identically on the regional `projects/{p}/locations/{l}/publishers/google/models/…` path and the express `publishers/google/models/…` one.
- Azure OpenAI provider mounted at `/azure/openai`, serving both of Azure's surfaces: the classic deployment-based one (`/openai/deployments/{deployment}/…?api-version=`, with the version required on every call) and the newer `/openai/v1` one, which is OpenAI's contract verbatim. Model catalog on both.
- Anthropic Files (beta): multipart upload, metadata, listing filterable by `scope_id`, download and delete, with the file's metadata carried inside the id it is minted so an upload round-trips without a store. Every call is gated on `anthropic-beta: files-api-2025-04-14` — comma-separated or repeated, both accepted — while the `?beta=true` the SDK appends is optional. A file you uploaded answers `403` on download, as on the real API; the simulated catalog carries two API-produced files so the download path is testable.
- A message whose only content is a file attachment now echoes the attachment (`Echo: [file_…]`) instead of falling through to the generic greeting, so a test can assert the reference arrived.
- `MultipartFile` in `src/core/multipart.ts` now also carries the part's own `Content-Type`, which Anthropic reports as `mime_type` (bare, with the charset the SDK's `toFile` appends stripped).
- Anthropic Message Batches, kept stateless by encoding the whole batch into its own `msgbatch_` id: create, retrieve, results as JSONL keyed by `custom_id`, cancel and delete, plus a list endpoint that is always empty. A batch is `ended` on arrival, so an `x-llm-mock-batch-status` header pins `in_progress` or `canceling` when a test needs the polling branch. Encoding bounds the size: past ~1600 characters of id, creation fails loudly instead of dropping requests.
- `POST /anthropic/v1/messages/count_tokens`, summing messages, `system` and the serialized tool declarations the same way `/v1/messages` builds `usage.input_tokens`, so counting then sending reports the same number twice.
- Anthropic streaming with named SSE events — `message_start` → `content_block_start`/`_delta`/`_stop` → `message_delta` → `message_stop`, with `input_json_delta` for tool arguments and a separate `signature_delta` after a thinking block. Both the `event:` lines and the `message_stop` terminator are required by the official client, making this the third SSE convention among the five providers.
- `POST /anthropic/v1/messages`: content blocks, a top-level `system` counted towards `input_tokens`, `stop_reason`/`stop_sequence`, tool use as `tool_use` blocks with decoded `input` and `toolu_` ids, `tool_choice` in its object form, and `thinking` blocks whose text `display` decides. `max_tokens` is required, as on the real API, and the conversation must open with the user.
- `src/core/tools.ts` now also reads a tool declared with `input_schema`, the fourth shape after OpenAI's nested `function`, the Responses API's top-level `parameters`, and Gemini's `functionDeclarations`.
- Anthropic provider mounted at `/anthropic`, validated against the official `@anthropic-ai/sdk`: model catalog with cursor pagination (`after_id`/`before_id`) and the real capability tree, authentication through `x-api-key` (with `Authorization: Bearer` for OAuth callers), a required `anthropic-version` header, and the doubly-wrapped error envelope whose `request_id` matches the `x-request-id` response header. Managed Agents is deliberately out of scope.
- Azure content filtering: `prompt_filter_results` on the response and `content_filter_results` on every choice, plus an `x-llm-mock-content-filter` header (`<target>` or `<target>:<category>:<severity>`) to pin the three documented failure paths — a blocked prompt as a `400` carrying its verdict in `innererror`, a filtered completion as `finish_reason: "content_filter"` with null content, and the "filter did not run" case. Streamed responses open with a choice-less chunk carrying the prompt's verdict, as Azure's do.
- `finish_reason` on the shared OpenAI chat types now admits `"content_filter"`, which is part of that contract even though the OpenAI provider never produces it.
- Azure's `/openai/v1` surface, serving the same inference handlers with no `api-version` and no deployments, so a plain `OpenAI` client reaches it with only a `baseURL` change. Both surfaces return the same body for the same request.
- `chat/completions` (with SSE streaming and tool calls) and `embeddings` on Azure's deployment path, reusing the OpenAI provider's services since the payloads are OpenAI's verbatim. The handlers are mounted so the `/openai/v1` surface can share them.
- Azure authentication through the `api-key` header, with `Authorization: Bearer` accepted for Entra ID callers. A missing credential answers in the API gateway's flatter `{statusCode, message}` shape; an invalid one in the wrapped `{error:{code, message}}` envelope.
- Any deployment name resolves, except those prefixed `missing-`, which return the real `404 DeploymentNotFound` — the same reserved-name convention already used for files on OpenAI and Gemini.
- Interactions API on Gemini Enterprise, reachable on both the express `/v1beta1/interactions` path and the regional one, where the SDK percent-encodes the whole version-project-location component into a single path segment that a literal version mount cannot match. The router itself now lives in `src/providers/google-shared/routes/interactions.ts`, shared verbatim by both Google providers.
- Gemini Enterprise embeddings through `:predict`, the generic prediction endpoint this platform uses instead of AI Studio's `:embedContent`: an `instances`/`predictions` envelope, `outputDimensionality` set once per call in a sibling `parameters` object, and `statistics.token_count` in snake_case. Plus `:countTokens`, which reports `totalTokens` alone.
- `:generateContent` and `:streamGenerateContent` on Gemini Enterprise, on both path shapes, reusing the shared generative core and adding the `createTime` this platform stamps on every response. Tool calls, `candidateCount` and the mock headers all carry over.
- Dual authentication for that provider, validated against the same key set: an OAuth bearer token (regional) failing as `401 UNAUTHENTICATED`, and an `x-goog-api-key` (express) failing as `400 INVALID_ARGUMENT`. `AuthScheme.invalidKeyError` now receives the request so a provider can tell its transports apart.
- Gemini's OpenAI-compatibility layer at `/gemini/v1beta/openai`: `chat/completions` (streaming and tool calls included), `embeddings` at Gemini's dimensions, and `models` serving Gemini's catalog in OpenAI's list envelope. Only what Google actually exposes is mounted, so the Responses API and Files `404` there as they do against the real service.
- Gemini embeddings: `:batchEmbedContents` (what the SDK calls even for a single input) and the singular `:embedContent`, with hash-seeded unit vectors, per-model native dimensions (3072 for `gemini-embedding-001`, 768 for the older models) and `outputDimensionality` truncation.
- `:countTokens`, accepting either a bare `contents` list or a whole `generateContentRequest` so a system instruction and tool declarations are counted too.
- Gemini Files API: the two-step resumable upload at `POST /gemini/upload/v1beta/files`, plus `GET /files` with `pageSize`/`pageToken`, `GET /files/{name}` and an idempotent `DELETE`.
- Stateless resumable uploads: the session metadata rides inside the `x-goog-upload-url` handed to the client, and the file's metadata inside the name it is minted, so `upload` → `get` round-trips on any instance without a store. `sha256Hash` is the real digest of the bytes received.
- Interactions API, Google's next-generation surface: `POST /gemini/v1beta/interactions` with `steps`, snake_case `usage` and tool calls, `GET /interactions/{id}` synthesized statelessly (with `?stream=true` replay), `POST /interactions/{id}/cancel` and an idempotent `DELETE`.
- Interactions streaming: `interaction.created` → `step.start` / `step.delta` / `step.stop` → `interaction.completed`, with `arguments_delta` pieces for a function call.
- Gemini tool calls: `tools[].functionDeclarations[]` and `toolConfig.functionCallingConfig` (`ANY`, `NONE`, `AUTO`, `allowedFunctionNames`), emitted as `functionCall` parts whose `args` is a decoded object. Loops terminate on a `functionResponse` part, and both mock headers apply.
- Gemini authentication via `x-goog-api-key`, with the `?key=` query parameter and `Authorization: Bearer` also accepted. The API key set is shared across providers.
- Gemini error envelopes: `google.rpc.Status` (`code`/`message`/`status`/`details`) on the classic surface, and the flatter Interactions-style envelope under `/interactions`.
- Routing for Google's `{resource}:{method}` custom methods, so `models/gemini-3.6-flash:generateContent` reaches a handler instead of tripping over Express' `:` parameter syntax.
- Tool calling on both Chat Completions and the Responses API: `tool_choice: "required"` or a named function returns real tool calls, with arguments synthesized from the tool's JSON Schema (`default`, then the first `enum` value, then a per-type placeholder).
- `x-llm-mock-tool-calls` header to pin the exact tool calls a response must contain, including parallel calls and verbatim (even malformed) argument strings.
- Tool calls in streaming: `delta.tool_calls` chunks keyed by `index` with `finish_reason: "tool_calls"` on Chat Completions, and `response.function_call_arguments.delta`/`.done` events on the Responses API.
- Agent loops terminate: a `role: "tool"` message or a `function_call_output` item stops `tool_choice` from forcing further calls.

### Changed

- The README is down from 778 lines to 175: it now covers what the project is, why you would use it, how to start it and how to control its replies, and points at [llm-mock.dev](https://llm-mock.dev/api.html) for the rest. The per-endpoint detail it used to carry — 433 lines of it — lives on the documentation site, one page per provider, which is where it stays current.
- The documentation site's API reference is now one page per provider — `api-openai.html`, `api-anthropic.html`, `api-gemini.html`, `api-gemini-enterprise.html`, `api-azure.html` — with `api.html` keeping what they share (base URLs, authentication, response-control headers, provider support) and linking out to each. The stylesheet moved to `docs/styles.css` rather than being copied inline into six pages; `sitemap.xml` lists all seven URLs. Every section id was preserved, so existing deep links still resolve.
- The Responses API now echoes the `tools` and `tool_choice` it received instead of always reporting `[]` and `"auto"`.
- Tests are now grouped by provider under `tests/openai/` and `tests/gemini/`, sharing the server harness in `tests/server.ts`.
- Tool-calling logic moved from `src/providers/openai/services/tools.ts` to `src/core/tools.ts`, now that a second provider uses it.
- Deterministic embedding vectors moved to `src/core/embeddings.ts`, shared by both providers; what differs between them is the wire envelope and the default dimension count, not the vector.
- Google's two Gemini surfaces now share a `src/providers/google-shared/` module holding the Content/Part model, `generateContent`, `countTokens`, the Interactions API and the `{resource}:{method}` path parser. The Gemini provider keeps what only AI Studio has — its model catalog, the Files API and `:embedContent` — ahead of a Gemini Enterprise provider that shares the generative core but embeds through `:predict` and has no Files API at all.

### Fixed

The Gemini provider was verified end to end against the live `generativelanguage.googleapis.com`, which corrected several shapes that had been built from documentation alone:

- Error `details` are emitted only for an invalid API key, and with `domain: "googleapis.com"` plus a `google.rpc.LocalizedMessage` entry. Every other error — missing credential, unknown model, unknown file, malformed body — carries no `details` at all.
- A credential failure under `/interactions` now answers in the classic `google.rpc.Status` envelope rather than that surface's next-gen one, because Google's frontend rejects the key before the service runs. The service's own errors keep the next-gen envelope.
- The OpenAI-compatibility layer answers credential failures with its own codes: `404 NOT_FOUND` for a missing credential (not `403`) and a shorter `Please pass a valid API key` with no details for a bad one.
- The compatibility layer now returns Google's error envelope rather than OpenAI's, including the `GenerateContentRequest.contents` complaint for a request with no `messages`, and its model objects carry `display_name` with no `created`. Completions no longer report a `system_fingerprint` or a `chatcmpl-` id prefix.
- Interaction objects gained `object: "interaction"`, `service_tier`, and the `total_cached_tokens`/`total_tool_use_tokens`/`total_thought_tokens` counters; their modality is lowercase `text`, they carry no `output_tokens_by_modality`, their timestamps have no fractional seconds, and a create no longer emits a `user_input` step.
- Catalog ids `gemini-3.1-pro` and `gemini-3-flash` do not exist; they are `gemini-3.1-pro-preview` and `gemini-3-flash-preview`.
- The Files `403` echoes the id as the caller wrote it, without the `files/` prefix.
- Tool argument synthesis no longer yields `null` for every property of a Gemini schema: types are matched case-insensitively, so Gemini's uppercase `Type` enum (`STRING`, `OBJECT`, ...) resolves like lowercase JSON Schema types.

## [0.3.0] - 2026-08-01

### Added

- Files API: `POST /openai/v1/files` (`multipart/form-data`, `purpose` validation, `expires_after`), `GET /openai/v1/files` with `purpose` filter and `limit`/`order`/`after` pagination, `GET`/`DELETE /openai/v1/files/{id}`, and `GET /openai/v1/files/{id}/content` with deterministic placeholder bytes.
- Uploads API for the chunked flow: `POST /openai/v1/uploads`, `.../parts` (up to 64 MB per part), `.../complete` and `.../cancel`.
- Stateless file identity: the file id encodes filename, size and purpose, so `create` → `retrieve` round-trips on any instance without a store.
- Reserved not-found ids (`file-missing*`, `upload_missing*`) to exercise 404 handling.
- Documentation site at [llm-mock.dev](https://llm-mock.dev): landing page, full API reference, Open Graph metadata, structured data, `robots.txt` and `sitemap.xml`.

## [0.2] - 2026-07-22

### Added

- Multi-provider architecture: each provider is a self-contained router with its own auth scheme and error envelope, mounted under its own prefix.
- Canned responses carried by the request itself via the `x-llm-mock-response` header (and `x-llm-mock-response-base64` for non-ASCII content).

### Changed

- **Breaking:** the project was renamed from `nopenAI` to `llm-mock`.
- **Breaking:** environment variables renamed from `NOPENAI_*` to `LLM_MOCK_*`.
- **Breaking:** OpenAI endpoints moved from `/v1/...` to `/openai/v1/...`.
- **Breaking:** the server is now fully stateless — identical requests return identical responses across restarts and replicas.

### Removed

- **Breaking:** the fixtures API (`POST`/`DELETE /__mock/responses`) and its in-memory stores, superseded by per-request canned responses.
- **Breaking:** in-memory persistence of responses; `GET /openai/v1/responses/{id}` now synthesizes a deterministic response for any id.

## [0.1.0] - 2026-07-22

### Added

- Initial release: an OpenAI-compatible mock server built with Bun, TypeScript and Express.
- Chat Completions, Responses, Models and Embeddings endpoints, with SSE streaming on chat completions and typed event streams on the Responses API.
- Deterministic output: content-hashed ids and hash-seeded embedding vectors.
- API key validation against `api-keys.json`, returning the real OpenAI error envelope for invalid keys, unknown models and validation errors.
- Configurable response fixtures matched by model, prompt content or regex, falling back to echoing the last user message.
- `GET /health` healthcheck.
- CI running the integration suite against the official `openai` SDK, and a release workflow publishing a multi-arch Docker image to GHCR.

[0.6.0]: https://github.com/axium-lab/llm-mock/compare/v0.5.0...v0.6.0
[0.3.0]: https://github.com/axium-lab/llm-mock/compare/v0.2...v0.3.0
[0.2]: https://github.com/axium-lab/llm-mock/compare/v0.1.0...v0.2
[0.1.0]: https://github.com/axium-lab/llm-mock/releases/tag/v0.1.0
