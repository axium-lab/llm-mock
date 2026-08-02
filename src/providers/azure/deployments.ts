import { ApiError } from "../../core/errors";

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
