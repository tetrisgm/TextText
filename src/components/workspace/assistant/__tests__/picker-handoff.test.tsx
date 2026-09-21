import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantRailShellProps } from "../AssistantRailShell";

const state = vi.hoisted(() => ({ requested: null as string | null, loaded: false }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }),
  useState: () => [state.requested, (value: string) => { state.requested = value; }],
  useSyncExternalStore: () => state.loaded ? { sidebar: { AssistantSidebar: "loaded-sidebar" } } : null,
}));
vi.mock("@/lib/motion/react", () => ({ useMotionPresence: () => ({ present: true, onRest: vi.fn() }) }));
vi.mock("../AssistantRailShell", () => ({ AssistantRailShell: "rail-shell" }));
vi.mock("@/components/keyboard/ShortcutTooltip", () => ({ ShortcutTooltip: "tooltip" }));
import { LazyAssistantSidebar } from "../AssistantBoundaryUI";

const props = { state: "pinned", workspaceHandle: "mira", contextKey: "draft" } as AssistantRailShellProps;
afterEach(() => { state.requested = null; state.loaded = false; });
function requestPicker() {
  const tree = LazyAssistantSidebar(props);
  const shell = React.Children.toArray(tree.props.children).find((child) => React.isValidElement(child) && child.type === "rail-shell") as React.ReactElement<{ onRequestContextPicker: () => void }>;
  shell.props.onRequestContextPicker();
}
it("hands the first picker click to the loaded sidebar", () => {
  requestPicker();
  state.loaded = true;
  expect(LazyAssistantSidebar(props).props.initialContextPickerOpen).toBe(true);
});
it("does not open a picker on ordinary activation or after navigating to another scope", () => {
  state.loaded = true;
  expect(LazyAssistantSidebar(props).props.initialContextPickerOpen).toBe(false);
  state.loaded = false;
  requestPicker();
  state.loaded = true;
  expect(LazyAssistantSidebar({ ...props, contextKey: "other" }).props.initialContextPickerOpen).toBe(false);
  expect(LazyAssistantSidebar({ ...props, workspaceHandle: "other" }).props.initialContextPickerOpen).toBe(false);
});
