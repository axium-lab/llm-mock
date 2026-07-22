import { createApp } from "./app";
import { loadConfig } from "./config";
import { loadApiKeys } from "./core/api-keys";

const config = loadConfig();
const apiKeys = loadApiKeys(config.apiKeysFile);
const app = createApp({ apiKeys });

app.listen(config.port, () => {
  console.log(`nopenAI listening on http://localhost:${config.port}`);
  console.log(`Point your OpenAI SDK at baseURL: http://localhost:${config.port}/openai/v1`);
  console.log(`${apiKeys.size} valid API keys loaded from ${config.apiKeysFile}`);
});
