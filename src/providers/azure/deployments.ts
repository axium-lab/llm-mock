import { ApiError } from "../../core/errors";
import { listModels } from "../openai/services/models";

// A deployment is a named alias a customer creates in their own Azure resource,
// pointing at a model. A mock has no resource and therefore no deployments, so
// any name is accepted — the same way every provider here accepts any model id.
//
// What cannot be dropped is the 404: DeploymentNotFound is the error Azure
// users hit most, and the one their code most needs to handle. It is driven by
// the name itself, the same convention as the reserved `file-missing` ids on
// OpenAI and `files/missing…` on Gemini.
export const MISSING_DEPLOYMENT_PREFIX = "missing-";

export function assertDeployment(name: string): string {
  if (!name || name.startsWith(MISSING_DEPLOYMENT_PREFIX)) {
    throw new ApiError(
      404,
      "The API deployment for this resource does not exist. If you created the deployment within the last 5 minutes, please wait a moment and try again.",
      "DeploymentNotFound",
    );
  }
  return name;
}

// The listing is the legacy data-plane shape — `GET /openai/deployments`, the
// one that lives under the same prefix as inference. Managing deployments moved
// to ARM (the control plane, on management.azure.com), which a mock behind a
// single base URL cannot represent; this exists so a client can discover names
// without leaving the endpoint it is already pointed at.
//
// `owner` and `scale_settings` are the documented fields of that shape and are
// filled with the values the docs show; their real content depends on a
// resource this mock does not have.
export interface AzureDeployment {
  scale_settings: { scale_type: "standard" };
  model: string;
  owner: string;
  id: string;
  status: "succeeded";
  created_at: number;
  updated_at: number;
  object: "deployment";
}

// Names invented for a deployment nobody created. A fixed timestamp keeps the
// output deterministic, the same reason the model catalog pins its `created`.
const SYNTHETIC_CREATED_AT = 1744318146;

function deployment(name: string, model: string, createdAt: number): AzureDeployment {
  return {
    scale_settings: { scale_type: "standard" },
    model,
    owner: "organization-owner",
    id: name,
    status: "succeeded",
    created_at: createdAt,
    updated_at: createdAt,
    object: "deployment",
  };
}

// One deployment per catalog model, named after the model it points at — the
// convention most Azure resources follow, and the one that makes a client
// configured with `deployment: "gpt-4o"` work without further setup.
export function listDeployments(): { object: "list"; data: AzureDeployment[] } {
  return {
    object: "list",
    data: listModels().data.map((model) => deployment(model.id, model.id, model.created)),
  };
}

// A name outside the catalog is still a valid deployment — the mock accepts any
// of them for inference, so refusing to describe them here would contradict
// that. Only the reserved prefix is missing.
export function getDeployment(name: string): AzureDeployment {
  assertDeployment(name);
  const model = listModels().data.find((entry) => entry.id === name);
  return deployment(name, model?.id ?? name, model?.created ?? SYNTHETIC_CREATED_AT);
}

// Every request on the classic surface carries ?api-version=. Azure rejects the
// request outright when it is absent, which is a flow worth being able to test.
export function assertApiVersion(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new ApiError(
      400,
      "The api-version query parameter (?api-version=) is required for every request.",
      "MissingApiVersionParameter",
    );
  }
  return value;
}
