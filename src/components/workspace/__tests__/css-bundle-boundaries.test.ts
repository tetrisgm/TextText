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
const tenantLayoutSource = readFileSync(
  new URL("../../../app/t/[handle]/layout.tsx", import.meta.url),
  "utf8",
);
const usernameLayoutSource = readFileSync(
  new URL("../../../app/u/[username]/layout.tsx", import.meta.url),
  "utf8",
);

describe("CSS bundle boundaries", () => {
  it("loads card styles with the card feature instead of every route", () => {
    expect(rootLayoutSource).not.toContain('styles/cards.css');
    expect(postCardSource).toContain('import "@/styles/cards.css"');
  });

  it("loads workspace styles only inside workspace route trees", () => {
    expect(rootLayoutSource).not.toContain('styles/workspace.css');
    expect(tenantLayoutSource).toContain('import "@/styles/workspace.css"');
    expect(usernameLayoutSource).toContain('import "@/styles/workspace.css"');
  });
});
