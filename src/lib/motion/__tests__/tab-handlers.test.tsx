import type { DragEvent, ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import type { MotionTab, Retained } from "../tabs";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";

const fixture = vi.hoisted(() => ({ entries: [] as Retained<WorkspacePoolPost>[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: vi.fn(),
}));
vi.mock("../tabs", () => ({
  MotionTab: vi.fn(), useTabLayout: vi.fn(),
  useRetainedTabs: () => ({ entries: fixture.entries, remove: vi.fn() }),
}));
beforeEach(() => { fixture.entries = []; });
it("rejects drag handlers on a retained exit even if the browser dispatches through inert", () => {
  const a = { id: "a", title: "A" } as WorkspacePoolPost;
  const b = { id: "b", title: "B" } as WorkspacePoolPost;
  const c = { id: "c", title: "C" } as WorkspacePoolPost;
  fixture.entries = [{ item: a, present: true }, { item: b, present: false }, { item: c, present: true }];
  const onMove = vi.fn();
  const result = WorkspaceTabBar({ posts: [a, c], activePostId: "a", previewPostId: null,
    onMove, onClose: vi.fn(), onPromote: vi.fn(), onSelect: vi.fn() });
  type Tab = ReactElement<Parameters<typeof MotionTab>[0]>;
  // The tablist renders the sr-only keyboard help first, then the tabs.
  const [, tabs] = (result as ReactElement<{ children: [ReactElement, Tab[]] }>).props.children;
  const [first, exiting, last] = tabs;
  const event = { preventDefault: vi.fn(), dataTransfer: { setData: vi.fn() } } as unknown as DragEvent<HTMLDivElement>;
  expect(exiting.props.draggable).toBe(false);
  exiting.props.onDragStart?.(event); first.props.onDrop?.(event); expect(onMove).not.toHaveBeenCalled();
  first.props.onDragStart?.(event);
  exiting.props.onDragOver?.(event); exiting.props.onDrop?.(event);
  expect(onMove).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled();
  last.props.onDrop?.(event); expect(onMove).toHaveBeenCalledExactlyOnceWith(0, 1);
});
