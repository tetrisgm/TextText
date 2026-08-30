import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../useNativeAssistant.ts", import.meta.url),
  "utf8",
);

describe("assistant streaming integration", () => {
  it("coalesces both native and hosted provider deltas", () => {
    expect(source.match(/createAssistantTextDeltaBuffer/g)).toHaveLength(3);
    expect(source).toContain("nativeTextBufferRef.current = pending");
    expect(source).toContain("cloudTextBuffer.current.push(event.text)");
  });

  it("flushes pending text before terminal replacement and settlement", () => {
    const nativeFinal = source.indexOf('event.type === "final-text"');
    const nativeFlush = source.indexOf(
      "nativeTextBufferRef.current?.buffer.finish()",
      nativeFinal,
    );
    const nativeReplace = source.indexOf("text: event.text", nativeFinal);
    expect(nativeFlush).toBeGreaterThan(nativeFinal);
    expect(nativeReplace).toBeGreaterThan(nativeFlush);

    const hostedResult = source.indexOf(
      "const result = await cloudAssistantTurn",
    );
    const hostedFlush = source.indexOf(
      "cloudTextBuffer.current?.finish()",
      hostedResult,
    );
    const hostedReplace = source.indexOf("text: finalText", hostedResult);
    expect(hostedFlush).toBeGreaterThan(hostedResult);
    expect(hostedReplace).toBeGreaterThan(hostedFlush);
  });
});
