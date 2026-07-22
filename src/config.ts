import { resolve } from "node:path";

export interface Config {
  port: number;
  apiKeysFile: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.NOPENAI_PORT ?? env.PORT ?? 3000),
    apiKeysFile: resolve(env.NOPENAI_API_KEYS_FILE ?? "api-keys.json"),
  };
}
