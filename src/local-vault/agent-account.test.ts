import { describe, expect, it } from "vitest";
import { connectedAccountLabel } from "./agent-account";

describe("agent account label", () => {
  it("shows a bounded connected account without retaining unsafe values", () => {
    expect(connectedAccountLabel("  writer@example.test ")).toBe("Connected as writer@example.test");
    expect(connectedAccountLabel("writer@example.test\nprivate detail")).toBeNull();
    expect(connectedAccountLabel("x".repeat(255))).toBeNull();
    expect(connectedAccountLabel(undefined)).toBeNull();
  });
});
