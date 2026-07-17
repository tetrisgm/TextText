import { describe, expect, it } from "vitest";
import { createWorkspaceHoverTracker } from "@/lib/workspace-hover";

describe("workspace hover arming", () => {
  it("requires new pointer coordinates after navigation or scroll", () => {
    const hover = createWorkspaceHoverTracker();

    expect(hover.moved(120, 80)).toBe(true);
    hover.disarm();
    expect(hover.moved(120, 80)).toBe(false);
    expect(hover.moved(121, 80)).toBe(true);
    expect(hover.moved(121, 80)).toBe(false);
  });

  it("ignores invalid pointer coordinates", () => {
    const hover = createWorkspaceHoverTracker();
    expect(hover.moved(Number.NaN, 10)).toBe(false);
    expect(hover.moved(10, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
