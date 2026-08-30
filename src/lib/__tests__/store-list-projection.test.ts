import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storeSource = readFileSync("src/lib/store.ts", "utf8");

function sourceOf(functionName: string): string {
  const start = storeSource.indexOf(`function ${functionName}(`);
  const end = storeSource.indexOf("\n}", start);
  return storeSource.slice(start, end + 2);
}

describe("store list projection", () => {
  it("bounds every item body preview, including notes", () => {
    const bodyPreview = sourceOf("bodyPreviewSql");

    expect(bodyPreview).toContain("left(${posts.body}, ${BODY_PREVIEW_LENGTH})");
    expect(bodyPreview).not.toContain("posts.type");
    expect(bodyPreview).not.toMatch(/then\s+nullif\(\$\{posts\.body\}/);
  });
});
