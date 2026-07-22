import { createApp, providers } from "./app";
import { loadConfig } from "./config";
import { loadApiKeys } from "./core/api-keys";

const config = loadConfig();
const apiKeys = loadApiKeys(config.apiKeysFile);
const app = createApp({ apiKeys });

app.listen(config.port, () => {
  console.log(`nopenAI listening on http://localhost:${config.port}`);
  for (const provider of providers) {
    console.log(`- ${provider.name}: baseURL http://localhost:${config.port}${provider.baseURLPath}`);
  }
  console.log(`${apiKeys.size} valid API keys loaded from ${config.apiKeysFile}`);
});
