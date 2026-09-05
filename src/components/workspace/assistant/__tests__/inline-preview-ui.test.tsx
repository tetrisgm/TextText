import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineSelectionPreview, InlinePreviewRefinement } from "../InlineSelectionPreview";
import type { InlinePreviewController, InlinePreviewRecord, InlineStatus } from "../inline-preview";

function markup(status: InlineStatus, extra: Partial<InlinePreviewRecord> = {}) {
  const snapshot = () => ({ status, action: "rewrite" as const, title: "Project brief", itemId: "item", words: 86, text: "Replacement text", ...extra });
  const controller = { snapshot, subscribe: () => () => {} } as unknown as InlinePreviewController;
  return renderToStaticMarkup(<InlineSelectionPreview controller={controller} surface={{} as never} readSelection={() => null} onClose={() => {}} />);
}
const refinementButtons = ["Refine", "Shorter", "Longer", "More formal", "More casual", "Simplify"];
const buttons = (html: string) => Array.from(html.matchAll(/<button[^>]*>([^<]+)<\/button>/g), (match) => match[1]);

describe("inline preview UI", () => {
  it("places focus on the region and keeps streaming text out of the live announcement", () => {
    const html = markup("ready");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region" aria-label="Selection preview"');
    expect(html).toContain('aria-live="off">Replacement text');
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true">Ready');
    expect(html).toContain('Rewrite · Project brief · 86 selected words');
    expect(buttons(html)).toEqual(["Accept", "Discard", "Try again", ...refinementButtons]);
  });
  it("renders state-specific controls with no acceptance for incomplete output", () => {
    expect(buttons(markup("generating"))).toEqual(["Stop", ...refinementButtons]);
    expect(buttons(markup("applied"))).toEqual(["Undo", "Close"]);
    expect(buttons(markup("stale"))).toEqual(["Discard", "Regenerate"]);
    expect(buttons(markup("failed"))).toEqual(["Discard", "Retry"]);
    expect(buttons(markup("failed", { uncertain: true }))).toEqual(["Discard"]);
    const applying = markup("applying");
    expect((applying.match(/disabled=""/g) ?? []).length).toBe(9);
  });
  it("makes summary insertion primary and names excerpt metadata explicitly", () => {
    expect(buttons(markup("ready", { action: "summarize" }))).toEqual(["Insert below", "Discard", "Replace selection", "Try again", ...refinementButtons]);
    expect(markup("ready", { action: "excerpt" })).toContain("Set document excerpt · Project brief");
  });
  it("renders model output as text, without executing HTML or partial Markdown", () => {
    const html = markup("generating", { text: '<img src=x onerror="alert(1)"> **unfinished' });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("**unfinished");
  });
});


describe("inline refinement controls", () => {
  function field(disabled = false, value = "  Make it warm  ") {
    const onChange = vi.fn(), onSubmit = vi.fn(), onEscape = vi.fn();
    const element = InlinePreviewRefinement({ value, disabled, onChange, onSubmit, onEscape });
    const input = element.props.children[0].props.children[0];
    const submit = element.props.children[0].props.children[1].props.children;
    const chips = element.props.children[1].props.children;
    const key = (key: string, nativeEvent = { isComposing: false, keyCode: 0 }) => {
      const event = { key, nativeEvent, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      input.props.onKeyDown(event);
      return event;
    };
    return { element, input, submit, chips, onChange, onSubmit, onEscape, key };
  }
  it("submits trimmed free text on Enter and isolates it from card shortcuts", () => {
    const f = field();
    f.input.props.onChange({ target: { value: "Custom instruction" } });
    expect(f.onChange).toHaveBeenCalledExactlyOnceWith("Custom instruction");
    const event = f.key("Enter");
    expect(f.onSubmit).toHaveBeenCalledExactlyOnceWith("Make it warm");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it("routes Escape to preview focus without submitting or bubbling to Discard", () => {
    const f = field(); const event = f.key("Escape");
    expect(f.onEscape).toHaveBeenCalledOnce();
    expect(f.onSubmit).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
  it.each([{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }])("ignores composition Enter %j", (nativeEvent) => {
    const f = field(); const event = f.key("Enter", nativeEvent);
    expect(f.onSubmit).not.toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it("submits each quick chip as its instruction", () => {
    const f = field();
    for (const chip of f.chips) chip.props.onClick();
    expect(f.onSubmit.mock.calls).toEqual(refinementButtons.slice(1).map((label) => [label]));
    f.submit.props.onClick();
    expect(f.onSubmit).toHaveBeenLastCalledWith("Make it warm");
  });
  it("rejects whitespace and disabled submissions from every control", () => {
    const empty = field(false, "  ");
    empty.key("Enter"); empty.submit.props.onClick();
    expect(empty.submit.props.disabled).toBe(true);
    expect(empty.onSubmit).not.toHaveBeenCalled();
    const busy = field(true);
    busy.key("Enter"); busy.submit.props.onClick();
    for (const chip of busy.chips) { expect(chip.props.disabled).toBe(true); chip.props.onClick(); }
    expect(busy.input.props.disabled).toBe(true);
    expect(busy.onSubmit).not.toHaveBeenCalled();
  });
  it.each(["generating", "applying", "ready"] as const)("renders a labelled single-line field in %s", (status) => {
    const html = markup(status);
    expect(html).toContain('type="text" aria-label="Refine the preview" placeholder="Tell the assistant what to change"');
    expect(/<input[^>]*disabled=""/.test(html)).toBe(status !== "ready");
  });
});
