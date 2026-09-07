import React, { type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ItemCommentView } from "@/app/editor/actions";
const driver = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, effects: [] as (() => (() => void) | void)[], refs: [] as { current: unknown }[], refCursor: 0, list: vi.fn() }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = driver.cursor++;
    if (!(index in driver.states)) driver.states[index] = initial;
    return [driver.states[index], (next: unknown) => { driver.states[index] = typeof next === "function" ? next(driver.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = driver.refCursor++; return driver.refs[index] ??= { current: initial }; },
  useEffect: (effect: () => (() => void) | void) => { driver.effects.push(effect); },
}));
vi.mock("@/components/keyboard/CommandLayer", () => ({ useEscapeLayer: vi.fn() }));
vi.mock("@/app/editor/actions", () => ({ listItemCommentsAction: driver.list, addItemCommentAction: vi.fn(), replyItemCommentAction: vi.fn(), reopenItemCommentAction: vi.fn(), resolveItemCommentAction: vi.fn() }));
import { ReaderComments } from "../ReaderComments";
import { OPEN_READER_COMMENTS } from "@/lib/reader-comments-events";
const comment: ItemCommentView = { id: "comment", parentId: null, body: "Check this", authorName: "Alex", createdAt: "today", updatedAt: "today", resolved: false, resolvedAt: null, anchor: null };
let page: EventTarget & { visibilityState: string };
function render(canComment = true) { driver.cursor = 0; driver.refCursor = 0; driver.effects = []; return renderToStaticMarkup(<ReaderComments canResolve={canComment} canComment={canComment} handle="writer" postId="item" sourceBody="Hello" />); }
beforeEach(() => {
  driver.states = []; driver.refs = []; driver.list.mockReset(); vi.useFakeTimers();
  page = Object.assign(new EventTarget(), { visibilityState: "visible" }); vi.stubGlobal("document", page);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("keeps the same list identity for unchanged reads, but receives replies and resolution changes", async () => {
  driver.list.mockResolvedValue([comment]);
  render(); const cleanup = driver.effects[0]();
  await vi.advanceTimersByTimeAsync(0);
  const initial = driver.states[0];
  driver.list.mockResolvedValue([{ ...comment }]);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(driver.states[0]).toBe(initial);
  driver.list.mockResolvedValue([{ ...comment, resolved: true }, { ...comment, id: "reply", parentId: comment.id }]);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(driver.states[0]).toEqual([{ ...comment, resolved: true }, { ...comment, id: "reply", parentId: comment.id }]);
  cleanup?.();
});
it("does not list comments while hidden, and cleans up after leaving the item", async () => {
  driver.list.mockResolvedValue([]); page.visibilityState = "hidden";
  render(); const cleanup = driver.effects[0]();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(driver.list).not.toHaveBeenCalled();
  page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(driver.list).toHaveBeenCalledTimes(1);
  page.visibilityState = "hidden"; page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(driver.list).toHaveBeenCalledTimes(1);
  cleanup?.();
  page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(driver.list).toHaveBeenCalledTimes(1);
});
function retryButton(node: ReactNode): ReactElement<{ onClick: () => void }> | undefined {
  if (!React.isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.type === "button" && node.props.children === "Reload comments") return node as ReactElement<{ onClick: () => void }>;
  for (const child of React.Children.toArray(node.props.children)) { const found = retryButton(child); if (found) return found; }
}
it("offers an outside-popover retry that recovers a failed initial load", async () => {
  driver.list.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([comment]);
  render(); const cleanup = driver.effects[0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(render()).toContain("Could not load comments.");
  expect(render()).not.toContain('role="dialog"');
  driver.cursor = 0; driver.refCursor = 0;
  let tree: ReactNode;
  function Inspect() {
    tree = ReaderComments({ canResolve: true, handle: "writer", postId: "item", sourceBody: "Hello" });
    return tree;
  }
  renderToStaticMarkup(<Inspect />);
  const retry = retryButton(tree);
  expect(retry).toBeDefined();
  retry!.props.onClick();
  await vi.advanceTimersByTimeAsync(0);
  expect(driver.list).toHaveBeenCalledTimes(2);
  expect(render()).not.toContain("Could not load comments.");
  expect(driver.states[0]).toEqual([comment]);
  cleanup?.();
});

it.each([true, false])("the toolbar event opens this item's comments with composer permission %s", async (canComment) => {
  driver.list.mockResolvedValue([comment]);
  const browser = Object.assign(new EventTarget(), { requestAnimationFrame: (callback: () => void) => callback() });
  vi.stubGlobal("window", browser);
  render(canComment);
  const stopLoad = driver.effects[0]();
  const stopOpen = driver.effects[1]();
  await vi.advanceTimersByTimeAsync(0);
  browser.dispatchEvent(new CustomEvent(OPEN_READER_COMMENTS, { detail: { postId: "other-item" } }));
  expect(render(canComment)).not.toContain('role="dialog"');
  browser.dispatchEvent(new CustomEvent(OPEN_READER_COMMENTS, { detail: { postId: "item" } }));
  const html = render(canComment);
  expect(html).toContain('aria-label="Comments"');
  expect(html).toContain("Check this");
  expect(html.includes('placeholder="Add a comment"')).toBe(canComment);
  stopLoad?.(); stopOpen?.();
});
