import React from "react";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "context-search",
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value;
    }];
  },
}));
import { AssistantContextPicker, AssistantContextSearch } from "../AssistantContextPicker";
import { DEFAULT_CONTEXT_CHOICE } from "@/lib/ai/context-choice";

type Element = React.ReactElement<Record<string, unknown>>;
function find(node: React.ReactNode, predicate: (element: Element) => boolean): Element {
  const elements: Element[] = [];
  const walk = (value: React.ReactNode) => React.Children.forEach(value, (child) => {
    if (!React.isValidElement<Record<string, unknown>>(child)) return;
    elements.push(child); walk(child.props.children as React.ReactNode);
  });
  walk(node);
  const result = elements.find(predicate);
  if (!result) throw new Error("Missing control");
  return result;
}
function invoke(element: Element, handler: string, value?: unknown) {
  (element.props[handler] as (value?: unknown) => void)(value);
}
function key(key: string, composing = false) {
  return { key, nativeEvent: { isComposing: composing, keyCode: composing ? 229 : 0 }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}
const items = [
  { id: "00000000-0000-4000-8000-000000000001", name: "One", detail: "Notes" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Two", detail: "Research" },
];
afterEach(() => { hooks.values = []; hooks.cursor = 0; });
it("opens Add, changes a chip, removes an item, and returns focus to the composer on Escape", () => {
  let choice = { ...DEFAULT_CONTEXT_CHOICE, itemIds: [items[0].id] };
  const focusComposer = vi.fn();
  let open = false;
  const render = () => {
    hooks.cursor = 0;
    return AssistantContextPicker({ choice, onChange: (value) => { choice = value; }, items, hasItem: true, hasSelection: true, focusComposer, open, onOpenChange: (value) => { open = value; } });
  };
  let tree = render();
  invoke(find(tree, (e) => e.type === "button" && e.props.children === "This item"), "onClick");
  expect(choice.includeItem).toBe(false);
  tree = render();
  invoke(find(tree, (e) => e.props["aria-label"] === "Remove context One"), "onClick");
  expect(choice.itemIds).toEqual([]);
  tree = render();
  invoke(find(tree, (e) => e.props["aria-label"] === "Add TextText context"), "onClick");
  tree = render();
  expect(find(tree, (e) => e.props["aria-label"] === "Add TextText context").props["aria-expanded"]).toBe(true);
  const escape = key("Escape");
  invoke(tree, "onKeyDown", escape);
  expect(focusComposer).toHaveBeenCalledOnce();
  expect(escape.stopPropagation).toHaveBeenCalledOnce();
  expect(find(render(), (e) => e.props["aria-label"] === "Add TextText context").props["aria-expanded"]).toBe(false);
});
it("selects the active search result with ArrowDown and Enter and ignores IME Enter", () => {
  const onAdd = vi.fn(), onClose = vi.fn();
  const render = () => { hooks.cursor = 0; return AssistantContextSearch({ items, selected: [], onAdd, onClose }); };
  let input = find(render(), (e) => e.props.role === "combobox");
  invoke(input, "onKeyDown", key("ArrowDown"));
  input = find(render(), (e) => e.props.role === "combobox");
  expect(input.props["aria-activedescendant"]).toBe("context-search-1");
  invoke(input, "onKeyDown", key("Enter", true));
  expect(onAdd).not.toHaveBeenCalled();
  invoke(input, "onKeyDown", key("Enter"));
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(items[1]);
  expect(onClose).toHaveBeenCalledOnce();
});
it("searches folders interactively and closes with Escape without choosing a result", () => {
  const onAdd = vi.fn(), onClose = vi.fn();
  const render = () => { hooks.cursor = 0; return AssistantContextSearch({ items, selected: [], onAdd, onClose }); };
  invoke(find(render(), (e) => e.props.role === "combobox"), "onChange", { target: { value: "Research" } });
  const tree = render();
  const option = find(tree, (e) => e.props.role === "option");
  expect(option.props["aria-selected"]).toBe(true);
  invoke(tree, "onKeyDown", key("Escape"));
  expect(onAdd).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledOnce();
});

it("handles the actual window-capture Escape callback without hiding a focused context picker", () => {
  const source = readFileSync("src/components/workspace/assistant/AssistantSidebar.tsx", "utf8");
  const start = source.indexOf('  useEscapeLayer(visible && focusWithin, "Assistant",');
  const callback = source.slice(start, source.indexOf("\n  useEffect(", start));
  const hideAssistant = vi.fn(), setContextPickerOpen = vi.fn(), focus = vi.fn();
  let close = () => {};
  let focused = true;
  const install = new Function("useEscapeLayer", "visible", "focusWithin", "contextControlsRef", "document", "setContextPickerOpen", "composerRef", "hideAssistant", callback);
  install((_open: boolean, _label: string, handler: () => void) => { close = handler; }, true, true,
    { current: { contains: () => focused } }, { activeElement: {} }, setContextPickerOpen, { current: { focus } }, hideAssistant);
  close();
  expect(setContextPickerOpen).toHaveBeenCalledExactlyOnceWith(false);
  expect(focus).toHaveBeenCalledOnce(); expect(hideAssistant).not.toHaveBeenCalled();
  focused = false;
  close();
  expect(hideAssistant).toHaveBeenCalledOnce();
});

it("R9 preserves a usable active option when the live item list shrinks", () => {
  const onAdd = vi.fn(), onClose = vi.fn();
  let available = items;
  const render = () => { hooks.cursor = 0; return AssistantContextSearch({ items: available, selected: [], onAdd, onClose }); };
  invoke(find(render(), e => e.props.role === "combobox"), "onKeyDown", key("ArrowDown"));
  // The first item disappears following deletion/access refresh. The active
  // second item is still readable, now at index zero.
  available = [items[1]];
  const input = find(render(), e => e.props.role === "combobox");
  invoke(input, "onKeyDown", key("Enter"));
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(items[1]);
  expect(onClose).toHaveBeenCalledOnce();
});
