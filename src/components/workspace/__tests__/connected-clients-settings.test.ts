import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../WorkspaceSettings.tsx", import.meta.url),
  "utf8",
);

describe("connected clients settings", () => {
  it("keeps a large token history concise until the owner expands it", () => {
    expect(source).toContain("tokenClients.slice(0, 8)");
    expect(source).toContain("Show all ${tokenClients.length} clients");
    expect(source).toContain("Show fewer clients");
    expect(source).toContain("aria-expanded={allTokensVisible}");
  });
});
