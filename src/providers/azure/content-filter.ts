import type { Request } from "express";
import { ApiError } from "../../core/errors";

// Azure runs every prompt and completion through Azure AI Content Safety and
// reports the verdict inline. It is the most Azure-specific thing about the
// service, and the reason an OpenAI-shaped client can meet a response it did
// not expect.
//
// Four categories carry a severity; the optional detectors are binary.
const SEVERITY_CATEGORIES = ["hate", "self_harm", "sexual", "violence"] as const;
const DETECTION_CATEGORIES = ["jailbreak"] as const;

type SeverityCategory = (typeof SEVERITY_CATEGORIES)[number];
type DetectionCategory = (typeof DETECTION_CATEGORIES)[number];

const SEVERITIES = ["safe", "low", "medium", "high"] as const;
type Severity = (typeof SEVERITIES)[number];

export interface FilterResults {
  [category: string]: { filtered: boolean; severity?: Severity } | { filtered: boolean; detected: boolean } | unknown;
}

export interface PromptFilterResult {
  prompt_index: number;
  content_filter_results: FilterResults;
}

// What a request can pin about the filter's verdict.
//
//   prompt       the prompt is blocked outright — a 400, no completion at all
//   completion   the reply is cut, and that choice's finish_reason says so
//   unavailable  the filter did not run, reported as an error object inline
export type FilterTarget = "prompt" | "completion" | "unavailable";

export interface FilterOverride {
  target: FilterTarget;
  category: SeverityCategory | DetectionCategory;
  severity: Severity;
}

const HEADER = "x-llm-mock-content-filter";

const DEFAULT_CATEGORY: SeverityCategory = "hate";
const DEFAULT_SEVERITY: Severity = "high";

function isSeverityCategory(value: string): value is SeverityCategory {
  return (SEVERITY_CATEGORIES as readonly string[]).includes(value);
}

function isDetectionCategory(value: string): value is DetectionCategory {
  return (DETECTION_CATEGORIES as readonly string[]).includes(value);
}

// `<target>` or `<target>:<category>:<severity>`, e.g. "prompt" or
// "completion:violence:medium". Without a header the filter finds nothing,
// which is what the overwhelming majority of real responses look like.
export function contentFilterOverride(req: Request): FilterOverride | undefined {
  const raw = req.headers[HEADER];
  if (typeof raw !== "string" || !raw) return undefined;

  const [target, category, severity] = raw.split(":");
  if (target !== "prompt" && target !== "completion" && target !== "unavailable") {
    throw new ApiError(
      400,
      `${HEADER} must start with 'prompt', 'completion' or 'unavailable'.`,
      "BadRequest",
    );
  }
  if (category !== undefined && !isSeverityCategory(category) && !isDetectionCategory(category)) {
    throw new ApiError(
      400,
      `Unknown content filter category '${category}'. Supported: ${[...SEVERITY_CATEGORIES, ...DETECTION_CATEGORIES].join(", ")}.`,
      "BadRequest",
    );
  }
  if (severity !== undefined && !(SEVERITIES as readonly string[]).includes(severity)) {
    throw new ApiError(
      400,
      `Unknown content filter severity '${severity}'. Supported: ${SEVERITIES.join(", ")}.`,
      "BadRequest",
    );
  }

  return {
    target,
    category: (category as SeverityCategory | DetectionCategory) ?? DEFAULT_CATEGORY,
    severity: (severity as Severity) ?? DEFAULT_SEVERITY,
  };
}

function benign(categories: readonly string[]): FilterResults {
  const results: FilterResults = {};
  for (const category of categories) {
    results[category] = isSeverityCategory(category)
      ? { filtered: false, severity: "safe" }
      : { filtered: false, detected: false };
  }
  return results;
}

// The verdict on the prompt. Only a `prompt` override flags anything: a
// completion-side block says nothing about the input.
export function promptFilterResults(override?: FilterOverride): PromptFilterResult[] {
  const results = benign([...SEVERITY_CATEGORIES, ...DETECTION_CATEGORIES]);
  if (override?.target === "prompt") {
    results[override.category] = isSeverityCategory(override.category)
      ? { filtered: true, severity: override.severity }
      : { filtered: true, detected: true };
  }
  return [{ prompt_index: 0, content_filter_results: results }];
}

// The verdict on one generated choice. The prompt's own detectors are absent
// here: jailbreak is an input-side signal.
export function choiceFilterResults(override?: FilterOverride): FilterResults {
  if (override?.target === "unavailable") {
    // The documented shape for "the filter could not run" — an error object
    // where the categories would be. Clients are told to check for it.
    return { error: { code: "content_filter_error", message: "The contents are not filtered" } };
  }

  const results = benign(SEVERITY_CATEGORIES);
  if (override?.target === "completion" && isSeverityCategory(override.category)) {
    results[override.category] = { filtered: true, severity: override.severity };
  }
  return results;
}

export function blocksCompletion(override?: FilterOverride): boolean {
  return override?.target === "completion";
}
