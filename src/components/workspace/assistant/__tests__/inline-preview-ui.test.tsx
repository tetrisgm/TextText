import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineSelectionPreview } from "../InlineSelectionPreview";
import type { InlinePreviewController, InlinePreviewRecord, InlineStatus } from "../inline-preview";

function markup(status: InlineStatus, extra: Partial<InlinePreviewRecord> = {}) {
  const snapshot = () => ({ status, action: "rewrite" as const, title: "Project brief", itemId: "item", words: 86, text: "Replacement text", ...extra });
  const controller = { snapshot, subscribe: () => () => {} } as unknown as InlinePreviewController;
  return renderToStaticMarkup(<InlineSelectionPreview controller={controller} surface={{} as never} readSelection={() => null} onClose={() => {}} />);
}
const buttons = (html: string) => Array.from(html.matchAll(/<button[^>]*>([^<]+)<\/button>/g), (match) => match[1]);

describe("inline preview UI", () => {
  it("places focus on the region and keeps streaming text out of the live announcement", () => {
    const html = markup("ready");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region" aria-label="Selection preview"');
    expect(html).toContain('aria-live="off">Replacement text');
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true">Ready');
    expect(html).toContain('Rewrite · Project brief · 86 selected words');
    expect(buttons(html)).toEqual(["Accept", "Discard"]);
  });
  it("renders state-specific controls with no acceptance for incomplete output", () => {
    expect(buttons(markup("generating"))).toEqual(["Stop"]);
    expect(buttons(markup("applied"))).toEqual(["Undo", "Close"]);
    expect(buttons(markup("stale"))).toEqual(["Discard", "Regenerate"]);
    expect(buttons(markup("failed"))).toEqual(["Discard", "Retry"]);
    expect(buttons(markup("failed", { uncertain: true }))).toEqual(["Discard"]);
    const applying = markup("applying");
    expect((applying.match(/disabled=""/g) ?? []).length).toBe(2);
  });
  it("makes summary insertion primary and names excerpt metadata explicitly", () => {
    expect(buttons(markup("ready", { action: "summarize" }))).toEqual(["Insert below", "Discard", "Replace selection"]);
    expect(markup("ready", { action: "excerpt" })).toContain("Set document excerpt · Project brief");
  });
  it("renders model output as text, without executing HTML or partial Markdown", () => {
    const html = markup("generating", { text: '<img src=x onerror="alert(1)"> **unfinished' });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("**unfinished");
  });
});
