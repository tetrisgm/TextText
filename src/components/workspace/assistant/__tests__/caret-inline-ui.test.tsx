import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as inline from "../inline-preview";
import * as quick from "@/lib/ai/quick-actions";
import * as envelopes from "@/lib/ai/selection-envelope";
import * as surfaces from "@/components/document/inline-selection-surface";
import * as drafts from "@/lib/ai/workspace-item-draft";
import * as previewEvents from "../selection-preview-event";
import { SELECTION_ERROR_EVENT } from "../selection-error";
import type { ReactElement } from "react";

// Execute production handlers/effects with deterministic hooks and explicit DOM
// geometry. This checks row selection and positioning, not native browser paint.
function compile(source: string, dependencies: Record<string, unknown>) {
  return new Function(...Object.keys(dependencies), ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)(...Object.values(dependencies));
}
function component(name: string, hooks: object) {
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {
    "@/lib/motion/react": { useExitMotion: (_ref: unknown, close: () => void) => close },
    react: hooks, "react/jsx-runtime": jsx, "./inline-preview": inline,
    "@/lib/ai/quick-actions": quick, "@/lib/ai/selection-envelope": envelopes,
    "@/components/document/inline-selection-surface": surfaces,
    "@/lib/ai/workspace-item-draft": drafts, "./selection-preview-event": previewEvents,
    "./selection-error": { SELECTION_ERROR_EVENT }, "./InlineSelectionPreview": { InlineSelectionPreview: () => null },
  };
  compile(readFileSync(`src/components/workspace/assistant/${name}.tsx`, "utf8"), {
    exports, require: (id: string) => {
      if (id.endsWith(".css")) return { default: {} };
      if (!(id in modules)) throw new Error(`Missing test module ${id}`);
      return modules[id];
    },
  });
  return exports[name] as (props: object) => ReactElement | null;
}
function harness(name: string, node: object) {
  let cursor = 0;
  const cells: unknown[] = [];
  const effects: (() => void)[] = [];
  const cleanups: (() => void)[] = [];
  const hooks = {
    useRef: (value: unknown) => { const i = cursor++; return cells[i] ??= { current: value }; },
    useState: (value: unknown) => {
      const i = cursor++; if (!(i in cells)) cells[i] = value;
      return [cells[i], (next: unknown) => { cells[i] = next; }];
    },
    useCallback: (fn: unknown, deps: unknown[]) => {
      const i = cursor++;
      const previous = cells[i] as { fn: unknown; deps: unknown[] } | undefined;
      if (previous && deps.every((dep, index) => dep === previous.deps[index])) return previous.fn;
      cells[i] = { fn, deps }; return fn;
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useEffect: (fn: () => (() => void) | void, deps: unknown[]) => {
      const i = cursor++; const previous = cells[i] as unknown[] | undefined;
      if (previous && deps.every((dep, index) => dep === previous[index])) return;
      cells[i] = deps;
      effects.push(() => { cleanups[i]?.(); const cleanup = fn(); cleanups[i] = cleanup ?? (() => {}); });
    },
    useLayoutEffect: (fn: () => (() => void) | void, deps: unknown[]) => hooks.useEffect(fn, deps),
  };
  const render = component(name, hooks);
  return {
    render(props: object) {
      cursor = 0;
      const tree = render(props) as ReactElement<Record<string, unknown>> | null;
      const ref = tree?.props.ref as { current: object } | undefined;
      if (ref) ref.current = node;
      effects.splice(0).forEach((effect) => effect());
      return tree;
    },
    dispose: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}
function button(tree: unknown, label: string): { onClick: () => void | Promise<void> } {
  const find = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return undefined;
    if (Array.isArray(value)) return value.map(find).find(Boolean);
    const element = value as ReactElement<{ children?: unknown }>;
    if (element.type === "button" && element.props.children === label) return element.props;
    return find(element.props?.children);
  };
  const found = find(tree);
  if (!found) throw new Error(`Missing button ${label}`);
  return found as ReturnType<typeof button>;
}
const caret = { field: "body" as const, start: 6, end: 6, text: "" };
const initial = { revision: 7, title: "Draft", excerpt: "", body: "First\nSecond\nThird" };
function dom() {
  const doc = Object.assign(new EventTarget(), { activeElement: null as unknown, querySelectorAll: () => [editor] });
  const win = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 900, setTimeout, clearTimeout });
  const row = (top: number) => ({ isConnected: true, style: { marginBottom: "4px" }, getBoundingClientRect: () => ({ top, bottom: top + 24, left: 200, right: 800, width: 600 }) });
  const rows = [row(100), row(200), row(300)];
  const root = { isConnected: true, contains: (node: unknown) => node === root,
    getBoundingClientRect: () => ({ left: 200, width: 600 }), closest: () => null,
    focus: vi.fn(() => { doc.activeElement = root; }),
  };
  const editor = { dataset: { aiItemId: "item" }, querySelector: () => root };
  const range = { setStart: vi.fn(), setEnd: vi.fn() };
  Object.assign(doc, { createRange: () => range });
  Object.assign(win, { getSelection: () => ({ removeAllRanges: vi.fn(), addRange: vi.fn() }) });
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  doc.activeElement = root;
  // Run MarkdownSurface's actual registration and offset mapping. The two
  // adjacent rows ensure an off-by-one at a newline cannot pass this test.
  const markdown = readFileSync("src/components/document/MarkdownSurface.tsx", "utf8");
  const registration = markdown.slice(markdown.indexOf("    return registerInlineSelectionSurface(root"), markdown.indexOf("  }, [ref]);", markdown.indexOf("    return registerInlineSelectionSurface(root")));
  const mapping = markdown.slice(markdown.indexOf("function lineAtOffset("), markdown.indexOf("\n}", markdown.indexOf("function lineAtOffset(")) + 2);
  const rangeRef = { current: {} };
  const valueRef = { current: initial.body };
  const cleanup = compile(mapping + "\n" + registration, {
    root, registerInlineSelectionSurface: surfaces.registerInlineSelectionSurface,
    lineStartsRef: { current: [0, 6, 13] }, wrappersRef: { current: rows }, winRef: { current: { start: 0 } },
    valueRef, rangeRef,
    positionWithin: (node: unknown, offset: number) => ({ node, offset }), requestDocumentCaret: vi.fn(),
  });
  const preview = { style: {} as Record<string, string>, offsetHeight: 160, focus: vi.fn(), contains: () => false };
  return { doc, win, root, rows, preview, range, rangeRef, valueRef, cleanup };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("caret inline UI", () => {
  it("anchors the preview to the caret row and Accept inserts there through the guarded edit", async () => {
    const d = dom(); let current = { ...initial };
    const execute = vi.fn(async (edit: inline.InlineEdit) => {
      await envelopes.validateSelectionEditEnvelope(edit.selection_envelope, "item", current, { ...edit, text: edit.expected_text });
      current = { ...current, revision: 8, body: current.body.slice(0, edit.start) + edit.replacement_text + current.body.slice(edit.end) };
    });
    const controller = inline.createInlinePreview({ itemId: "item", action: "continue", selection: caret }, {
      read: async () => current, active: () => true, persist: vi.fn(), execute,
      generate: async (envelope) => ({ text: "New line\n", selectionEnvelope: envelope }),
    });
    const surface = surfaces.captureInlineSelectionSurface("item", caret)!;
    const ui = harness("InlineSelectionPreview", d.preview);
    const props = { controller, surface, readSelection: () => caret, onClose: vi.fn() };
    ui.render(props);
    await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    const tree = ui.render(props);
    expect(surface.passage()).toBe(d.rows[1]);
    expect(d.preview.style).toMatchObject({ top: "232px", left: "208px", width: "560px", visibility: "visible" });
    expect(d.rows.map((row) => row.style.marginBottom)).toEqual(["4px", "176px", "4px"]);
    button(tree, "Accept").onClick();
    await vi.waitFor(() => expect(controller.snapshot().status).toBe("applied"));
    expect(execute.mock.calls[0][0]).toMatchObject({ field: "body", start: 6, end: 6, expected_text: "", selection_envelope: { start: 6, end: 6, text: "" } });
    expect(current.body).toBe("First\nNew line\nSecond\nThird");
    ui.dispose(); d.cleanup();
    expect(d.rows[1].style.marginBottom).toBe("4px");
  });
  it("Discard restores the collapsed caret in the original body row", async () => {
    const d = dom(); const close = vi.fn();
    const controller = inline.createInlinePreview({ itemId: "item", action: "continue", selection: caret }, {
      read: async () => initial, active: () => true, persist: vi.fn(), execute: vi.fn(),
      generate: async (envelope) => ({ text: "Draft", selectionEnvelope: envelope }),
    });
    const ui = harness("InlineSelectionPreview", d.preview);
    const props = { controller, surface: surfaces.captureInlineSelectionSurface("item", caret), readSelection: () => caret, onClose: close };
    ui.render(props); await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
    button(ui.render(props), "Discard").onClick();
    expect(controller.snapshot().status).toBe("discarded"); expect(close).toHaveBeenCalledOnce();
    expect(d.root.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(d.range.setStart).toHaveBeenCalledWith(d.rows[1], 0); expect(d.range.setEnd).toHaveBeenCalledWith(d.rows[1], 0);
    expect(d.rangeRef.current).toEqual({ anchor: 6, head: 6 });
    ui.dispose(); d.cleanup();
  });
  it("clamps Discard restoration after the body shrinks past the frozen caret", () => {
    const d = dom(); const surface = surfaces.captureInlineSelectionSurface("item", caret)!;
    d.valueRef.current = "Fir"; surface.restore();
    expect(d.range.setStart).toHaveBeenCalledWith(d.rows[0], 3);
    expect(d.range.setEnd).toHaveBeenCalledWith(d.rows[0], 3);
    expect(d.rangeRef.current).toEqual({ anchor: 3, head: 3 }); d.cleanup();
  });
  it("offers only Continue after 800 ms idle in the focused body and opens its inline controller", async () => {
    vi.useFakeTimers(); const d = dom(); const run = vi.fn(async () => ({ dispose: vi.fn() }));
    let selection: drafts.WorkspaceItemTextSelection | null = caret;
    const props = { enabled: true, itemId: "item", readSelection: () => selection, onRunAction: run };
    const ui = harness("SelectionActions", d.preview);
    expect(ui.render(props)).toBeNull();
    d.doc.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(799); expect(ui.render(props)).toBeNull();
    vi.advanceTimersByTime(1);
    const tree = ui.render(props);
    expect(tree?.props["aria-label"]).toBe("AI action at the caret");
    expect(() => button(tree, "Rewrite")).toThrow("Missing button");
    await button(tree, "Continue writing").onClick();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith({ itemId: "item", action: "continue", selection: caret });
    ui.dispose(); d.cleanup();
    selection = null;
  });
  it.each(["typing", "composition", "title", "blur", "scroll"])("hides or suppresses the caret affordance for %s", (activity) => {
    vi.useFakeTimers(); const d = dom();
    const props = { enabled: true, itemId: "item", readSelection: () => activity === "title" ? { ...caret, field: "title" } : caret, onRunAction: vi.fn() };
    const ui = harness("SelectionActions", d.preview); ui.render(props);
    d.doc.dispatchEvent(new Event("selectionchange")); vi.advanceTimersByTime(500);
    if (activity === "typing") d.doc.dispatchEvent(new Event("keydown"));
    if (activity === "composition") { d.doc.dispatchEvent(new Event("compositionstart")); d.doc.dispatchEvent(new Event("input")); }
    if (activity === "blur") { d.doc.activeElement = {}; d.doc.dispatchEvent(new Event("focusin")); }
    if (activity === "scroll") d.win.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(1500); expect(ui.render(props)).toBeNull();
    ui.dispose(); d.cleanup();
  });
});


describe("rail Continue routing", () => {
  const source = readFileSync("src/components/workspace/assistant/useNativeAssistant.ts", "utf8");
  const callback = source.slice(source.indexOf("  const runQuickAction = useCallback("), source.indexOf("  const applyProposalValue = useCallback("));
  function setup(level = "edit", selection: drafts.WorkspaceItemTextSelection | null = caret) {
    const d = dom();
    const preview = { snapshot: () => ({ status: "generating" }), dispose: vi.fn() };
    const createSelectionPreview = vi.fn(async () => preview);
    const presentSelectionPreview = vi.fn(() => true);
    // This checkpoint is before the unchanged rail generation/proposal flow.
    const rail = vi.fn(() => { throw new Error("rail flow reached"); });
    const reportSelectionError = vi.fn();
    const dependencies = {
      useCallback: (fn: unknown) => fn, ownerScopeReady: true, conversationStoreKey: "owner",
      threadKey: "thread", busyThreads: new Set(), getViewRef: { current: () => ({ level, postId: "item" }) },
      readOpenWorkspaceItemDraft: () => selection ? { ...initial, selection: null, writingSelection: selection } : null,
      INLINE_ACTIONS: inline.INLINE_ACTIONS, isBodyCaret: inline.isBodyCaret,
      captureInlineSelectionSurface: surfaces.captureInlineSelectionSurface,
      createSelectionPreview, presentSelectionPreview, reportSelectionError,
      SELECTION_INVALID_ERROR: envelopes.SELECTION_INVALID_ERROR, NATIVE_QUICK_ACTIONS: quick.NATIVE_QUICK_ACTIONS,
      setThreadBusy: rail, contextKey: "item", contextLabel: () => "Draft", handle: "writer",
      selectedCloudModel: null, setCloudProvider: vi.fn(),
    };
    const run = compile(callback + "\nreturn runQuickAction;", dependencies) as (action: string) => Promise<void>;
    return { d, run, createSelectionPreview, presentSelectionPreview, rail, reportSelectionError };
  }
  it("uses the frozen writing caret after rail focus and presents an inline preview", async () => {
    const s = setup(); s.d.doc.activeElement = {};
    await s.run("continue");
    expect(s.createSelectionPreview).toHaveBeenCalledExactlyOnceWith({ itemId: "item", action: "continue", selection: caret });
    expect(s.presentSelectionPreview.mock.calls[0]).toBeDefined();
    expect(s.rail).not.toHaveBeenCalled(); s.d.cleanup();
  });
  it("keeps the rail path when the item is not open in the editor", async () => {
    const s = setup("detail"); await expect(s.run("continue")).rejects.toThrow("rail flow reached");
    expect(s.rail).toHaveBeenCalled(); expect(s.createSelectionPreview).not.toHaveBeenCalled(); s.d.cleanup();
  });
  it("R8 refuses Continue from a metadata caret instead of starting the legacy field-writing flow", async () => {
    const s = setup("edit", { ...caret, start: 2, end: 2, field: "title" });
    try {
      await s.run("continue").catch(() => {});
      expect(s.rail).not.toHaveBeenCalled();
      expect(s.createSelectionPreview).not.toHaveBeenCalled();
    } finally { s.d.cleanup(); }
  });
  it("does not turn a metadata caret or a missing caret into inline drafting", async () => {
    for (const selection of [{ ...caret, field: "title" as const }, null]) {
      const s = setup("edit", selection);
      if (selection) {
        await s.run("continue");
        expect(s.rail).not.toHaveBeenCalled();
        expect(s.reportSelectionError).toHaveBeenCalledWith("item", expect.stringContaining("document body"));
      } else {
        await expect(s.run("continue")).rejects.toThrow("rail flow reached");
      }
      expect(s.createSelectionPreview).not.toHaveBeenCalled(); s.d.cleanup();
    }
  });
  it("keeps selected-text inline actions and rejects a missing editor surface", async () => {
    const selection = { field: "body" as const, start: 0, end: 5, text: "First" };
    const s = setup("edit", selection); await s.run("rewrite");
    expect(s.createSelectionPreview).toHaveBeenCalledWith({ itemId: "item", action: "rewrite", selection });
    s.d.cleanup();
    await s.run("continue");
    expect(s.reportSelectionError).toHaveBeenCalledWith("item", envelopes.SELECTION_INVALID_ERROR);
    expect(s.rail).not.toHaveBeenCalled();
  });
});


describe("round9 keyboard regressions", () => {
  it("R5 keeps Continue available when a keyboard user tabs from the focused body", () => {
    vi.useFakeTimers(); const d = dom();
    const props = { enabled: true, itemId: "item", readSelection: () => caret, onRunAction: vi.fn() };
    const ui = harness("SelectionActions", d.preview);
    try {
      ui.render(props);
      d.doc.dispatchEvent(new Event("selectionchange")); vi.advanceTimersByTime(800);
      expect(button(ui.render(props), "Continue writing")).toBeDefined();
      // Native Tab focus movement follows keydown. The toolbar must survive
      // this event to be a possible sequential-focus destination.
      d.doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Tab" }));
      expect(button(ui.render(props), "Continue writing")).toBeDefined();
    } finally { ui.dispose(); d.cleanup(); }
  });

  it("R6 does not Accept on the IME keyCode 229 fallback at the preview root", async () => {
    const d = dom(); const execute = vi.fn();
    const controller = inline.createInlinePreview({ itemId: "item", action: "continue", selection: caret }, {
      read: async () => initial, active: () => true, persist: vi.fn(), execute,
      generate: async envelope => ({ text: "new", selectionEnvelope: envelope }),
    });
    const ui = harness("InlineSelectionPreview", d.preview);
    const props = { controller, surface: surfaces.captureInlineSelectionSurface("item", caret), readSelection: () => caret, onClose: vi.fn() };
    try {
      ui.render(props); await vi.waitFor(() => expect(controller.snapshot().status).toBe("ready"));
      const tree = ui.render(props)!;
      (tree.props.onKeyDown as (event: unknown) => void)({ key: "Enter", metaKey: true,
        nativeEvent: { isComposing: false, keyCode: 229 }, preventDefault: vi.fn(), stopPropagation: vi.fn() });
      expect(controller.snapshot().status).toBe("ready");
      expect(execute).not.toHaveBeenCalled();
    } finally { ui.dispose(); d.cleanup(); }
  });
});
