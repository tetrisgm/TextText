import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldActivateVideoCover } from "@/lib/video-cover-policy";

const cardSource = readFileSync(
  new URL("../../components/PostCard.tsx", import.meta.url),
  "utf8",
);

describe("video cover activation", () => {
  it("activates only near the viewport on a visible page with motion enabled", () => {
    expect(
      shouldActivateVideoCover({
        nearViewport: true,
        pageVisible: true,
        reducedMotion: false,
      }),
    ).toBe(true);
    for (const blocked of [
      { nearViewport: false, pageVisible: true, reducedMotion: false },
      { nearViewport: true, pageVisible: false, reducedMotion: false },
      { nearViewport: true, pageVisible: true, reducedMotion: true },
    ]) {
      expect(shouldActivateVideoCover(blocked)).toBe(false);
    }
  });

  it("ships no source or autoplay attribute in the inactive server frame", () => {
    expect(cardSource).toContain('rootMargin: "500px 0px"');
    expect(cardSource).toContain('autoPlay={videoActive}');
    expect(cardSource).toContain('preload={videoActive ? "metadata" : "none"}');
    expect(cardSource).toContain("{videoActive && (");
    expect(cardSource).not.toContain("preload=\"auto\"");
  });
});
