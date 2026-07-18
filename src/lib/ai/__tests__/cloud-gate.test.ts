import { describe, expect, it } from "vitest";
import { cloudEnabled } from "@/lib/ai/cloud-gate";

describe("cloud assistant gate", () => {
  it("stays off without a workspace key or gateway key", () => {
    expect(cloudEnabled(null, undefined)).toBe(false);
  });

  it("enables a workspace-owned direct provider key", () => {
    expect(cloudEnabled({ apiKey: "user-key" }, undefined)).toBe(true);
  });

  it("keeps the owner gateway default working", () => {
    expect(cloudEnabled(null, "gateway-key")).toBe(true);
  });
});
