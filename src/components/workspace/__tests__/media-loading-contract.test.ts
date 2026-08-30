import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const folderSource = readFileSync(
  new URL("../../FolderPage.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../PostWorkspaceShell.tsx", import.meta.url),
  "utf8",
);

describe("workspace media loading", () => {
  it("does not eagerly fetch offscreen folder-feed media", () => {
    expect(folderSource).toContain('preload="none"');
    expect(folderSource).toContain('loading="lazy"');
  });

  it("keeps the first capture tile eager and defers the remaining page", () => {
    expect(shellSource).toContain(
      'loading={tile.index === 0 ? "eager" : "lazy"}',
    );
  });
});
