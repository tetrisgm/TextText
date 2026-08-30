import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootLayoutSource = readFileSync(
  new URL("../../../app/layout.tsx", import.meta.url),
  "utf8",
);
const postCardSource = readFileSync(
  new URL("../../PostCard.tsx", import.meta.url),
  "utf8",
);

describe("CSS bundle boundaries", () => {
  it("loads card styles with the card feature instead of every route", () => {
    expect(rootLayoutSource).not.toContain('styles/cards.css');
    expect(postCardSource).toContain('import "@/styles/cards.css"');
  });
});
