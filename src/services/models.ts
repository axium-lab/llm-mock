import type { Model } from "../types/openai";

// Simulated catalog with the usual model ids. `created` values are fixed so
// the output is fully deterministic.
const CATALOG: Model[] = [
  { id: "gpt-4.1", object: "model", created: 1744318146, owned_by: "openai" },
  { id: "gpt-4.1-mini", object: "model", created: 1744318146, owned_by: "openai" },
  { id: "gpt-4o", object: "model", created: 1715367049, owned_by: "openai" },
  { id: "gpt-4o-mini", object: "model", created: 1721172741, owned_by: "openai" },
  { id: "o3-mini", object: "model", created: 1737146383, owned_by: "openai" },
  { id: "text-embedding-3-small", object: "model", created: 1705948997, owned_by: "openai" },
  { id: "text-embedding-3-large", object: "model", created: 1705953180, owned_by: "openai" },
];

export function listModels(): { object: "list"; data: Model[] } {
  return { object: "list", data: CATALOG };
}

export function getModel(id: string): Model | undefined {
  return CATALOG.find((model) => model.id === id);
}
