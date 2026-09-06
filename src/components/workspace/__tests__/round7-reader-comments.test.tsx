/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const driver = vi.hoisted(() => ({ states: [] as any[], cursor: 0, effects: [] as any[], list: vi.fn() }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = driver.cursor++;
    if (!(index in driver.states)) driver.states[index] = typeof initial === "function" ? initial() : initial;
    return [driver.states[index], (next: any) => { driver.states[index] = typeof next === "function" ? next(driver.states[index]) : next; }];
  },
  useEffect: (effect: any) => { driver.effects.push(effect); },
}));
vi.mock("@/components/keyboard/CommandLayer", () => ({ useEscapeLayer: vi.fn() }));
vi.mock("@/app/editor/actions", () => ({ listItemCommentsAction: driver.list, addItemCommentAction: vi.fn(), replyItemCommentAction: vi.fn(), reopenItemCommentAction: vi.fn(), resolveItemCommentAction: vi.fn() }));
import { ReaderComments } from "../ReaderComments";
function render() { driver.cursor = 0; driver.effects = []; return renderToStaticMarkup(<ReaderComments canResolve handle="writer" postId="item" sourceBody="Hello" />); }
beforeEach(() => { driver.states = []; driver.list.mockReset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
it("round7: initial comment load failure is visible without opening a thread", async () => {
  driver.list.mockRejectedValue(new Error("Could not load comments."));
  render(); const cleanup = driver.effects[0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(render()).toContain("Could not load comments.");
  cleanup();
});
it("round7: open reader learns of another person's comments", async () => {
  driver.list.mockResolvedValue([]);
  render(); const cleanup = driver.effects[0]();
  await vi.advanceTimersByTimeAsync(60000);
  cleanup();
  expect(driver.list.mock.calls.length).toBeGreaterThan(1);
});
