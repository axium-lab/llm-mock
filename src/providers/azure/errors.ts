import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../core/errors";

// Azure's envelope looks like OpenAI's but is not it. `code` is a symbolic
// string ("DeploymentNotFound") where OpenAI uses a snake_case slug or null,
// and `type`/`param` are usually absent rather than explicitly null:
//
//   { "error": { "code": "DeploymentNotFound", "message": "..." } }
//
// One documented case breaks the pattern — a prompt blocked by the content
// filter carries `type`, `param` and even a `status` *inside* the error object,
// which OpenAI never does. That shape is built by the content-filter service
// rather than here, and travels through `extra`.
export interface AzureErrorExtra {
  type?: string | null;
  status?: number;
  // Azure nests the filter's verdict here when it blocks a prompt. Note the
  // singular `content_filter_result` inside, against the plural used
  // everywhere else — the service's own inconsistency.
  innererror?: { code: string; content_filter_result: unknown };
}

// Requests rejected by Azure's gateway, ahead of the service, answer in a
// flatter shape with no `error` wrapper at all.
export class AzureGatewayError extends ApiError {}

// A prompt blocked by the content filter is the documented case that carries
// `type`, a redundant `status`, and the verdict that caused the block.
export class AzureContentFilterError extends ApiError {
  readonly azure: AzureErrorExtra;

  constructor(contentFilterResult: unknown) {
    super(
      400,
      "The response was filtered due to the prompt triggering Azure OpenAI's content management policy. " +
        "Please modify your prompt and retry.",
      "content_filter",
      "prompt",
    );
    this.azure = {
      type: null,
      status: 400,
      innererror: { code: "ResponsibleAIPolicyViolation", content_filter_result: contentFilterResult },
    };
  }
}

function envelope(err: ApiError) {
  const extra = (err as ApiError & { azure?: AzureErrorExtra }).azure ?? {};
  return {
    error: {
      code: err.code ?? String(err.status),
      message: err.message,
      ...(err.param === null ? {} : { param: err.param }),
      ...("type" in extra ? { type: extra.type } : {}),
      ...(extra.status === undefined ? {} : { status: extra.status }),
      ...(extra.innererror === undefined ? {} : { innererror: extra.innererror }),
    },
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "404",
      message: `Resource not found: ${req.method} ${req.baseUrl}${req.path}`,
    },
  });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AzureGatewayError) {
    // No `error` wrapper: this is the API gateway talking, not the service.
    res.status(err.status).json({ statusCode: err.status, message: err.message });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json(envelope(err));
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: { code: "500", message } });
}
