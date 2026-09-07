import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Shallow markup and handler checks with mocked hooks, not mounted React or browser tests.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === "function" ? value(hooks.slots[index]) : value; }];
  },
  useRef: (initial: unknown) => { const index = hooks.cursor++; return hooks.slots[index] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useLayoutEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useId: () => `a11y-${hooks.cursor++}`,
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
}));
vi.mock("react-dom", async original => ({ ...await original<typeof import("react-dom")>(), createPortal: (children: unknown) => children }));
vi.mock("@/components/accessibility/useDialogFocus", () => ({ useDialogFocus: vi.fn(), usePopoverFocus: vi.fn() }));
vi.mock("@/components/keyboard/CommandLayer", () => ({ useEscapeLayer: vi.fn() }));
// Shallow rendering has no node to spring, so an exit never reaches rest on its
// own. Rest it at once: a dismissal is then observable in the same tick, as it
// was before surfaces animated out, and onClose still means "the panel closed".
vi.mock("@/lib/motion/react", async original => ({ ...await original<typeof import("@/lib/motion/react")>(),
  useExitMotion: (_ref: unknown, onClose: () => void) => Object.assign(onClose, { open: true, closing: false }),
}));
vi.mock("@/app/editor/actions", () => ({ listItemCommentsAction: vi.fn(async () => []), addItemCommentAction: vi.fn(async () => []), replyItemCommentAction: vi.fn(async () => []), resolveItemCommentAction: vi.fn(async () => []), reopenItemCommentAction: vi.fn(async () => []) }));
vi.mock("@/app/editor/agent-connect-actions", () => ({ createItemAgentAction: vi.fn(), prepareLocalItemAgentAction: vi.fn(), removeItemAgentAction: vi.fn() }));
vi.mock("@/auth", () => ({ hasAppleProvider: true, hasGoogleProvider: true, devLoginEnabled: false }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { CommentsDialog } from "@/components/workspace/CommentsDialog";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { SignInScreen } from "@/components/editor/SignInScreen";
import { AssistantContextPicker } from "@/components/workspace/assistant/AssistantContextPicker";
import { TemplateGallery } from "@/components/document/TemplateGallery";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { DEFAULT_CONTEXT_CHOICE } from "@/lib/ai/context-choice";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";
import { RemoveItemAgent } from "@/components/workspace/AddAgentPopover";
import { StatusAnnouncement } from "../StatusAnnouncement";
import type { WorkspacePoolPost } from "@/lib/pool/types";

type Element = React.ReactElement<Record<string, unknown>>;
function elements(node: React.ReactNode): Element[] {
  const found: Element[] = [];
  React.Children.forEach(node, child => { if (React.isValidElement<Record<string, unknown>>(child)) { found.push(child); found.push(...elements(child.props.children as React.ReactNode)); } });
  return found;
}
function find(node: React.ReactNode, predicate: (element: Element) => boolean) { const found = elements(node).find(predicate); if (!found) throw new Error("Missing control"); return found; }
function run(node: Element, handler: string, event?: unknown) { return (node.props[handler] as (event?: unknown) => unknown)(event); }
function key(key: string, extra = {}) { return { key, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra }; }
function render<T>(fn: () => T): T { hooks.cursor = 0; hooks.effects = []; return fn(); }
beforeEach(() => { hooks.slots = []; hooks.cursor = 0; hooks.effects = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("sign in renders one named main and an h1, with both provider names", () => {
  const html = renderToStaticMarkup(<SignInScreen />);
  expect(html.match(/<main\b/g)).toHaveLength(1);
  expect(html).toContain('aria-labelledby="signin-title"');
  expect(html).toContain('<h1 id="signin-title"');
  expect(html).toContain("Sign in with Apple"); expect(html).toContain("Sign in with Google");
});

it("tabs expose one keyboard entry, selection and a visible preview cue", () => {
  const tree = render(() => WorkspaceTabBar({ activePostId: "a", posts: [{ id: "a", title: "First" }, { id: "b", title: "Second" }] as WorkspacePoolPost[], previewPostId: "b", onClose: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onPromote: vi.fn() }));
  const tabs = elements(tree).filter(e => e.props.role === "tab");
  expect(tabs.map(e => e.props.tabIndex)).toEqual([0, -1]);
  expect(tabs.map(e => e.props["aria-selected"])).toEqual([true, false]);
  expect(tabs[0].props["aria-controls"]).toBe("workspace-item-panel");
  expect(renderToStaticMarkup(tree)).toContain("(Preview)");
});

it("tab arrows, Home/End, Delete, promotion and keyboard reorder call the real actions and recover focus", () => {
  const select = vi.fn(), close = vi.fn(), move = vi.fn(), promote = vi.fn();
  const first = { focus: vi.fn() }, second = { focus: vi.fn() }, main = { focus: vi.fn(), tabIndex: -1, hasAttribute: () => true };
  vi.stubGlobal("document", { querySelector: (selector: string) => selector.includes('[role="main"]') ? main : null });
  const props = { activePostId: "a", posts: [{ id: "a", title: "First" }, { id: "b", title: "Second" }] as WorkspacePoolPost[], previewPostId: "b", onClose: close, onSelect: select, onMove: move, onPromote: promote };
  const tree = render(() => WorkspaceTabBar(props));
  (tree!.props.ref as { current: unknown }).current = { querySelectorAll: () => [first, second] };
  const tabs = elements(tree).filter(e => e.props.role === "tab");
  run(tabs[0], "onKeyDown", key("ArrowRight")); expect(select).toHaveBeenLastCalledWith("b"); expect(second.focus).toHaveBeenCalledOnce();
  run(tabs[1], "onKeyDown", key("Home")); expect(select).toHaveBeenLastCalledWith("a");
  run(tabs[0], "onKeyDown", key("End")); expect(select).toHaveBeenLastCalledWith("b");
  run(tabs[1], "onKeyDown", key("Alt", { altKey: true })); expect(move).not.toHaveBeenCalled();
  run(tabs[1], "onKeyDown", key("ArrowLeft", { altKey: true })); expect(move).toHaveBeenCalledWith(1, 0);
  run(tabs[1], "onKeyDown", key("F2")); expect(promote).toHaveBeenCalledWith("b");
  run(tabs[1], "onKeyDown", key("Delete")); expect(close).toHaveBeenCalledWith("b"); expect(first.focus).toHaveBeenCalled();
  const lastTree = render(() => WorkspaceTabBar({ ...props, posts: props.posts.slice(0, 1) }));
  run(find(lastTree, e => e.props.role === "tab"), "onKeyDown", key("Delete")); expect(main.focus).toHaveBeenCalledOnce();
});

it("confirmation Enter is left to the focused native button and Cancel cannot confirm", () => {
  vi.stubGlobal("document", { body: {} });
  const cancel = vi.fn(), confirm = vi.fn();
  const tree = render(() => ConfirmationDialog({ open: true, title: "Delete?", message: "Move to Trash", confirmLabel: "Delete", onCancel: cancel, onConfirm: confirm }));
  const event = key("Enter"); run(tree as Element, "onKeyDown", event);
  expect(event.preventDefault).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  run(find(tree, e => e.type === "button" && e.props.children === "Cancel"), "onClick");
  expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  const html = renderToStaticMarkup(tree); expect(html).toContain('role="alertdialog"'); expect(html).toContain('aria-describedby=');
});

it("removing a context chip moves focus before removing the focused control", () => {
  const events: string[] = [];
  const tree = render(() => AssistantContextPicker({ choice: { ...DEFAULT_CONTEXT_CHOICE, itemIds: ["a"] }, items: [{ id: "a", name: "Notes", detail: "Folder" }], hasItem: true, hasSelection: false,
    onChange: value => events.push(value.itemIds.join(",")), focusComposer: () => events.push("focus") }));
  run(find(tree, e => e.props["aria-label"] === "Remove context Notes"), "onClick");
  expect(events).toEqual(["focus", ""]);
});

it("comment typing is silent and a successful post updates an atomic status", async () => {
  const props = { handle: "writer", postId: "item", postTitle: "Notes", canResolve: true, open: true, onClose: vi.fn() };
  let tree = render(() => CommentsDialog(props));
  run(find(tree, e => e.props["aria-label"] === "Add a comment"), "onChange", { currentTarget: { value: "A comment" } });
  tree = render(() => CommentsDialog(props));
  expect(find(tree, e => e.props.role === "status").props.children).toBe("");
  await run(find(tree, e => e.type === "form" && elements(e).some(c => c.props["aria-label"] === "Add a comment")), "onSubmit", { preventDefault: vi.fn() });
  tree = render(() => CommentsDialog(props));
  expect(find(tree, e => e.props.role === "status").props.children).toBe("Comment posted.");
  expect(find(tree, e => e.props.role === "status").props["aria-atomic"]).toBe("true");
  expect(find(tree, e => e.props["aria-label"] === "Comment status").props.role).toBe("group");
});

it("look search permits Escape but preserves Backspace text editing", () => {
  const listeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("window", { document: { body: { style: {} }, documentElement: { style: {} } }, addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), removeEventListener: vi.fn() });
  const close = vi.fn();
  render(() => TemplateGallery({ document: emptyDocumentSnapshot(), templates: BUILTIN_TEMPLATES.slice(0, 2), onClose: close, onApply: vi.fn() }));
  const cleanups = hooks.effects.map(effect => effect());
  const backspace = key("Backspace", { target: { matches: () => true } }); listeners.get("keydown")?.(backspace); expect(close).not.toHaveBeenCalled();
  const escape = key("Escape", { target: { matches: () => true } }); listeners.get("keydown")?.(escape); expect(close).toHaveBeenCalledOnce(); expect(escape.preventDefault).toHaveBeenCalledOnce();
  cleanups.forEach(cleanup => cleanup?.());
});

it("saving announcements debounce rapid state changes and cancel pending speech on unmount", async () => {
  vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, clearTimeout });
  render(() => StatusAnnouncement({ message: "Saving" })); const cancel = hooks.effects[0]();
  await vi.advanceTimersByTimeAsync(100); cancel?.();
  render(() => StatusAnnouncement({ message: "Saved" })); const cleanup = hooks.effects[0]();
  await vi.advanceTimersByTimeAsync(699);
  expect(render(() => StatusAnnouncement({ message: "Saved" })).props.children.props.children).toBe("");
  await vi.advanceTimersByTimeAsync(1);
  expect(render(() => StatusAnnouncement({ message: "Saved" })).props.children.props.children).toBe("Saved"); cleanup?.();
  expect(vi.getTimerCount()).toBe(0);
});

it("the reader adds one main landmark without wrapping or changing the document layout", () => {
  const document = emptyDocumentSnapshot(); document.content.title = "A title";
  const html = renderToStaticMarkup(<DocumentRenderer document={document} template={BUILTIN_TEMPLATES[0]} landmark="main" />);
  expect(html.match(/role="main"/g)).toHaveLength(1);
  expect(html).toContain('<article role="main" aria-label="Read item"');
  expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  hooks.cursor = 0;
  const preview = renderToStaticMarkup(<DocumentRenderer document={document} template={BUILTIN_TEMPLATES[0]} preview />);
  expect(preview).not.toContain('role="main"');
});
it("agent streaming text is not a live log, while activity has one atomic announcement", () => {
  const html = renderToStaticMarkup(<AssistantConversation submitting messages={[{ id: "answer", role: "assistant", text: "Streaming partial answer" }]} />);
  expect(html).toContain('role="log" aria-label="Conversation" aria-live="off"');
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html).toContain('aria-atomic="true">Assistant is working.');
});
it("agent removal confirmation and cancellation both keep a reachable focused action", () => {
  const focus = vi.fn();
  const grant = { id: "grant", name: "Agent" } as Parameters<typeof RemoveItemAgent>[0]["grant"];
  const props = { grant, handle: "writer", postId: "item", onRemoved: vi.fn() };
  let tree = render(() => RemoveItemAgent(props));
  run(find(tree, e => e.props.children === "Remove agent"), "onClick");
  tree = render(() => RemoveItemAgent(props));
  (find(tree, e => e.props.children === "Confirm removal").props.ref as { current: unknown }).current = { focus };
  hooks.effects.forEach(effect => effect()); expect(focus).toHaveBeenCalledOnce();
  run(find(tree, e => e.props.children === "Cancel"), "onClick");
  tree = render(() => RemoveItemAgent(props));
  (find(tree, e => e.props.children === "Remove agent").props.ref as { current: unknown }).current = { focus };
  hooks.effects.forEach(effect => effect()); expect(focus).toHaveBeenCalledTimes(2);
});

it("a stale active item still leaves one tab in keyboard order", () => {
  const tree = render(() => WorkspaceTabBar({ activePostId: "missing", posts: [{ id: "a", title: "First" }, { id: "b", title: "Second" }] as WorkspacePoolPost[], previewPostId: null, onClose: vi.fn(), onSelect: vi.fn(), onMove: vi.fn(), onPromote: vi.fn() }));
  expect(elements(tree).filter(e => e.props.role === "tab").map(e => e.props.tabIndex)).toEqual([0, -1]);
});

it("idle announcements stay empty and a second fast save replaces the live region child", async () => {
  vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, clearTimeout });
  render(() => StatusAnnouncement({ message: null })); let cleanup = hooks.effects[0]();
  await vi.advanceTimersByTimeAsync(700);
  expect(renderToStaticMarkup(render(() => StatusAnnouncement({ message: null })))).not.toContain("Saved");
  const complete = async () => {
    cleanup?.();
    render(() => StatusAnnouncement({ message: "Saving" })); cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(100); cleanup?.();
    render(() => StatusAnnouncement({ message: "Saved" })); cleanup = hooks.effects[0]();
    await vi.advanceTimersByTimeAsync(700);
    return render(() => StatusAnnouncement({ message: "Saved" })).props.children;
  };
  const first = await complete(), second = await complete();
  expect(first.props.children).toBe("Saved");
  expect(second.props.children).toBe("Saved");
  expect(second.key).not.toBe(first.key);
  cleanup?.(); expect(vi.getTimerCount()).toBe(0);
});

it("existing assistant history does not announce readiness before a submission", () => {
  const html = renderToStaticMarkup(<AssistantConversation submitting={false} messages={[{ id: "answer", role: "assistant", text: "Previous answer" }]} />);
  expect(html).not.toContain("Assistant is ready.");
  expect(html).not.toContain("Assistant is working.");
});
