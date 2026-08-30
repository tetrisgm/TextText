import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studioSource = readFileSync(
  new URL("../ItemTypeStudio.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../PostWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const studioStyles = readFileSync(
  new URL("../ItemTypeStudio.module.css", import.meta.url),
  "utf8",
);

describe("item type studio experience", () => {
  it("keeps AI refinement conversational and reversible", () => {
    expect(studioSource).toContain('aria-label="Design conversation"');
    expect(studioSource).toContain('placeholder="Tell the agent what to change..."');
    expect(studioSource).toContain('aria-label="Design version"');
    expect(studioSource).toContain("moveStudioTimeline(current, current.index - 1)");
    expect(studioSource).toContain("moveStudioTimeline(current, current.index + 1)");
  });

  it("offers before and after, device, and content-state previews", () => {
    expect(studioSource).toContain('aria-label="Preview content"');
    expect(studioSource).toContain('<option value="empty">Empty state</option>');
    expect(studioSource).toContain('<option value="stress">Stress test</option>');
    expect(studioSource).toContain('aria-label="Preview device"');
    expect(studioSource).toContain('aria-pressed={isComparing}');
    expect(studioSource).toContain('<span>Before</span>');
    expect(studioSource).toContain('<span>Current</span>');
  });

  it("surfaces quality findings and blocks only important failures", () => {
    expect(studioSource).toContain("assessItemTypeQuality(design.blueprint)");
    expect(studioSource).toContain('finding.severity === "important"');
    expect(studioSource).toContain('className={styles.preflight}');
    expect(studioSource).toContain(
      "disabled={Boolean(busy) || importantQualityFindings.length > 0}",
    );
  });

  it("loads a bounded set of canonical folder documents only on demand", () => {
    expect(shellSource).toContain("loadItemTypeStudioPreviewDocuments");
    expect(shellSource).toContain(".slice(0, 12)");
    expect(shellSource).toContain("ensurePostDocument(currentPool.blogId, post.id)");
    expect(shellSource).toContain(
      "loadPreviewDocuments={loadItemTypeStudioPreviewDocuments}",
    );
    expect(studioSource).toContain('previewContentMode !== "folder"');
    expect(studioSource).toContain("loadPreviewDocuments(folderPath)");
  });

  it("uses one scrolling surface at phone width", () => {
    const phoneRules = studioStyles.slice(
      studioStyles.indexOf("@media (max-width: 700px)"),
    );
    expect(phoneRules).toContain("grid-template-rows: auto auto;");
    expect(phoneRules).toContain("overflow: visible;");
  });
});
