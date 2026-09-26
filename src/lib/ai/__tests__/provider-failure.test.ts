import { describe, expect, it } from "vitest";
import { aiRequestId, classifyAiFailure, readAiFailure } from "../provider-failure";

describe("safe provider diagnostics", () => {
  const id = "27aa246c-5c98-4161-b50d-27a6fd66b072";
  it.each([
    [401, "authentication_error", "authentication"],
    [403, "permission_error", "model-access"],
    [404, "model_not_found", "model-access"],
    [429, "insufficient_quota", "quota"],
    [429, "rate_limit_error", "rate-limit"],
    [500, "server_error", "unknown"],
  ])("classifies %s/%s from upstream evidence", (statusCode, type, expected) => {
    const failure = classifyAiFailure({ statusCode, responseBody: JSON.stringify({ error: { type, message: "private source, bearer token, sk-secret" } }), responseHeaders: { "request-id": "req_1234567890", "retry-after": "900" } }, id);
    expect(failure).toMatchObject({ code: expected, requestId: id, upstreamStatus: statusCode, upstreamRequestId: "req_1234567890" });
    expect(JSON.stringify(failure)).not.toMatch(/private source|bearer token|sk-secret/);
    if (expected === "rate-limit") expect(failure.retryAfterSeconds).toBe(300);
  });
  it("does not echo arbitrary codes, messages, request IDs, or response fields", () => {
    const failure = classifyAiFailure({ statusCode: 500, responseBody: JSON.stringify({ error: { code: "sk-secret", message: "Private document body" }, request_id: "sk-secret" }), requestBodyValues: { apiKey: "sk-secret" } }, id);
    expect(failure.code).toBe("unknown");
    expect(JSON.stringify(failure)).not.toMatch(/sk-secret|Private document/);
    expect(readAiFailure({ ...failure, upstreamCode: "sk-secret", upstreamRequestId: "sk-secret", message: "Private document body" })).toEqual(failure);
  });
  it("distinguishes timeout, cancellation, and network interruption", () => {
    expect(classifyAiFailure(new DOMException("private", "TimeoutError"), id).code).toBe("timeout");
    expect(classifyAiFailure(new DOMException("private", "AbortError"), id).code).toBe("cancelled");
    expect(classifyAiFailure(new TypeError("fetch failed"), id).code).toBe("network");
  });
  it("accepts only UUIDs as caller correlation IDs", () => {
    expect(aiRequestId(id)).toBe(id);
    expect(aiRequestId("sk-private-token")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
