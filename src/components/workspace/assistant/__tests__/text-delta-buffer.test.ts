import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantTextDeltaBuffer } from "../text-delta-buffer";

afterEach(() => vi.useRealTimers());

describe("assistant text delta buffer", () => {
  it("turns hundreds of provider fragments into bounded visible mutations", () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    const buffer = createAssistantTextDeltaBuffer(
      (text) => chunks.push(text),
      50,
    );

    for (let index = 0; index < 500; index += 1) buffer.push("x");
    expect(chunks).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(chunks).toEqual(["x".repeat(500)]);
  });

  it("flushes terminal text exactly once and rejects late fragments", () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    const buffer = createAssistantTextDeltaBuffer((text) => chunks.push(text));

    buffer.push("before ");
    buffer.push("finish");
    buffer.finish();
    buffer.push(" too late");
    vi.runAllTimers();

    expect(chunks).toEqual(["before finish"]);
  });

  it("can discard a superseded turn without leaking its pending text", () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    const buffer = createAssistantTextDeltaBuffer((text) => chunks.push(text));
    buffer.push("old conversation");
    buffer.cancel();
    vi.runAllTimers();
    expect(chunks).toEqual([]);
  });
});
