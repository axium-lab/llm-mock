# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Tool calling on both Chat Completions and the Responses API: `tool_choice: "required"` or a named function returns real tool calls, with arguments synthesized from the tool's JSON Schema (`default`, then the first `enum` value, then a per-type placeholder).
- `x-llm-mock-tool-calls` header to pin the exact tool calls a response must contain, including parallel calls and verbatim (even malformed) argument strings.
- Tool calls in streaming: `delta.tool_calls` chunks keyed by `index` with `finish_reason: "tool_calls"` on Chat Completions, and `response.function_call_arguments.delta`/`.done` events on the Responses API.
- Agent loops terminate: a `role: "tool"` message or a `function_call_output` item stops `tool_choice` from forcing further calls.

### Changed

- The Responses API now echoes the `tools` and `tool_choice` it received instead of always reporting `[]` and `"auto"`.

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

[0.3.0]: https://github.com/axium-lab/llm-mock/compare/v0.2...v0.3.0
[0.2]: https://github.com/axium-lab/llm-mock/compare/v0.1.0...v0.2
[0.1.0]: https://github.com/axium-lab/llm-mock/releases/tag/v0.1.0
