# Manual requests

One `.http` file per provider and front door, for the VS Code [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension (or any tool that reads the format, such as the JetBrains HTTP client).

Start the server first, then open a file and click **Send Request** above any block:

```bash
bun start   # http://localhost:3000
```

Every file declares its own `@baseUrl` and `@apiKey` at the top, so pointing all of them at the hosted instance is a one-line change per file. Keys come from `api-keys.json` (`sk-mock-key-01` … `sk-mock-key-10`); `sk-mock-invalid` is the documented bad one.

| File | Door | Prefix |
| --- | --- | --- |
| `openai.http` | OpenAI | `/openai/v1` |
| `anthropic.http` | Anthropic | `/anthropic` |
| `gemini.http` | Gemini (AI Studio), native API and the OpenAI-compatible layer | `/gemini` |
| `gemini-enterprise.http` | Gemini Enterprise (ex-Vertex AI), regional and express modes | `/gemini-enterprise` |
| `azure-openai-classic.http` | Azure OpenAI, deployments API with `?api-version=` | `/azure/openai` |
| `azure-openai-v1.http` | Azure OpenAI / Microsoft Foundry, v1 route | `/azure/openai/v1` |
| `azure-anthropic.http` | Claude in Microsoft Foundry | `/azure/anthropic` |
| `azure-models.http` | Azure AI Model Inference API | `/azure/models` |

These are not run by `bun test`; the automated suite lives in the sibling folders and uses each provider's official SDK as the client.
