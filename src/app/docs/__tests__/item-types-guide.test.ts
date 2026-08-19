import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../item-types/page.tsx", import.meta.url), "utf8");
const copy = source.replace(/\s+/g, " ");

describe("the item-type guide", () => {
  it("covers the complete creation and preview loop", () => {
    for (const phrase of [
      "Undo and Redo",
      "Compare",
      "stress-test content",
      "phone frames",
      "deterministic preflight",
    ]) {
      expect(copy, `${phrase} documentation missing`).toContain(phrase);
    }
  });

  it("covers structured fields and named folder views", () => {
    for (const phrase of [
      "relations",
      "people records",
      "recurrence",
      "Computed values are read-only",
      "named folder views",
      "View menu",
    ]) {
      expect(copy, `${phrase} documentation missing`).toContain(phrase);
    }
  });

  it("covers the portable, immutable look lifecycle", () => {
    for (const phrase of [
      "Remix",
      "Export",
      "Import",
      "Version history",
      "new version instead of rewriting history",
    ]) {
      expect(copy, `${phrase} documentation missing`).toContain(phrase);
    }
  });
});
