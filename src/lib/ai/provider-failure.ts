/** Safe diagnostics shared by the HTTP routes and their clients. Provider
 * messages, response bodies, request bodies and credentials never cross this
 * boundary. Classification may inspect them, but output is an allowlist. */
export type AiFailureCode =
  | "authentication" | "model-access" | "quota" | "rate-limit"
  | "timeout" | "network" | "cancelled" | "invalid-template"
  | "configuration" | "unknown";

export type AiFailure = {
  code: AiFailureCode;
  message: string;
  recovery: "reconnect" | "configure" | "retry" | "wait" | "revise" | "none";
  requestId: string;
  upstreamStatus?: number;
  upstreamCode?: string;
  upstreamRequestId?: string;
  retryAfterSeconds?: number;
};

export const WORKSPACE_AI_CONNECTION_CHANGED_EVENT = "texttext:ai-connection-changed";

export function isAiFailureCode(value: unknown): value is AiFailureCode {
  return typeof value === "string" && Object.hasOwn(FAILURE_COPY, value);
}

const FAILURE_COPY: Record<AiFailureCode, Pick<AiFailure, "message" | "recovery">> = {
  authentication: { message: "The AI account rejected this connection. Reconnect to continue with your saved request.", recovery: "reconnect" },
  "model-access": { message: "This AI account cannot use the selected model. Choose an available model or reconnect with an account that has access.", recovery: "configure" },
  quota: { message: "The AI account has reached a usage or billing limit. Check the account with your provider, then retry your saved request.", recovery: "configure" },
  "rate-limit": { message: "The AI account is receiving too many requests. Wait a moment, then retry your saved request.", recovery: "wait" },
  timeout: { message: "The AI request timed out. Your request is preserved so you can retry.", recovery: "retry" },
  network: { message: "The AI connection was interrupted. Check your connection, then retry your saved request.", recovery: "retry" },
  cancelled: { message: "The AI request was cancelled. Your draft is preserved.", recovery: "none" },
  "invalid-template": { message: "The assistant could not produce a supported design. Refine your request and try again.", recovery: "revise" },
  configuration: { message: "The saved AI connection could not be read. Reconnect to continue with your saved request.", recovery: "reconnect" },
  unknown: { message: "The AI provider request failed for an unknown reason. Your request is preserved. Use the diagnostic reference if this continues.", recovery: "retry" },
};

export function aiRequestId(value?: string | null): string {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : crypto.randomUUID();
}

export function aiFailure(code: AiFailureCode, requestId: string): AiFailure {
  return { code, ...FAILURE_COPY[code], requestId };
}

export function readAiFailure(value: unknown): AiFailure | null {
  const data = record(value);
  if (!isAiFailureCode(data.code) || typeof data.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.requestId)) return null;
  const failure = aiFailure(data.code, data.requestId);
  if (typeof data.upstreamStatus === "number" && data.upstreamStatus >= 400 && data.upstreamStatus <= 599) failure.upstreamStatus = data.upstreamStatus;
  if (typeof data.upstreamCode === "string" && UPSTREAM_CODES.has(data.upstreamCode)) failure.upstreamCode = data.upstreamCode;
  if (typeof data.upstreamRequestId === "string" && /^(?:req_[A-Za-z0-9]{8,100}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(data.upstreamRequestId)) failure.upstreamRequestId = data.upstreamRequestId;
  if (typeof data.retryAfterSeconds === "number" && data.retryAfterSeconds > 0) failure.retryAfterSeconds = Math.min(300, Math.ceil(data.retryAfterSeconds));
  return failure;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

const UPSTREAM_CODES = new Set([
  "authentication_error", "invalid_api_key", "invalid_authentication",
  "permission_error", "permission_denied", "model_not_found", "not_found_error",
  "insufficient_quota", "billing_error", "billing_hard_limit_reached", "credit_balance_too_low",
  "rate_limit_error", "rate_limit_exceeded", "overloaded_error", "server_error",
]);

export function classifyAiFailure(error: unknown, requestId: string): AiFailure {
  const outer = record(error);
  const details = record(outer.lastError ?? (outer.statusCode || outer.responseBody ? error : outer.cause ?? error));
  let response: Record<string, unknown> = {};
  if (typeof details.responseBody === "string") {
    try { response = record(JSON.parse(details.responseBody.slice(0, 32_000))); } catch { /* No provider text is echoed. */ }
  }
  const providerError = record(response.error ?? details.data);
  const rawCode = providerError.code ?? providerError.type ?? details.code;
  const code = typeof rawCode === "string" ? rawCode : "";
  const message = [providerError.message, details.message, outer.message].filter((part) => typeof part === "string").join(" ").toLowerCase();
  const status = typeof details.statusCode === "number" ? details.statusCode : undefined;
  const name = String(outer.name ?? details.name ?? "");
  let kind: AiFailureCode = "unknown";
  if (name === "AbortError") kind = "cancelled";
  else if (name === "TimeoutError" || /timeout|timed out|etimedout/.test(message)) kind = "timeout";
  else if (status === 401 || /^(authentication_error|invalid_api_key|invalid_authentication)$/.test(code)) kind = "authentication";
  else if (/quota|billing|credit_balance/.test(code) || /credit balance is too low|insufficient quota|billing hard limit/.test(message)) kind = "quota";
  else if (status === 429 || /rate_limit|overloaded/.test(code)) kind = "rate-limit";
  else if (status === 403 || status === 404 || /^(permission_error|permission_denied|model_not_found|not_found_error)$/.test(code)) kind = "model-access";
  else if (/fetch failed|network|econnreset|enotfound|connection.*(closed|refused)/.test(message)) kind = "network";
  const failure = aiFailure(kind, requestId);
  if (status && status >= 400 && status <= 599) failure.upstreamStatus = status;
  if (UPSTREAM_CODES.has(code)) failure.upstreamCode = code;
  const headers = record(details.responseHeaders);
  const upstreamRequestId = headers["request-id"] ?? headers["x-request-id"] ?? response.request_id;
  if (typeof upstreamRequestId === "string" && /^(?:req_[A-Za-z0-9]{8,100}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(upstreamRequestId)) {
    failure.upstreamRequestId = upstreamRequestId;
  }
  const retry = Number(headers["retry-after"]);
  if (kind === "rate-limit" && Number.isFinite(retry) && retry > 0) failure.retryAfterSeconds = Math.min(300, Math.ceil(retry));
  return failure;
}

export function aiFailureStatus(failure: AiFailure): number {
  if (failure.code === "cancelled") return 499;
  if (failure.code === "rate-limit") return 429;
  if (failure.code === "timeout") return 504;
  // Provider authentication is distinct from the TextText session's 401/403.
  return 502;
}

export class AiConnectionError extends Error {
  constructor(readonly failure: AiFailure) {
    super(`${failure.message} Reference: ${failure.requestId}`);
    this.name = "AiConnectionError";
  }
}
