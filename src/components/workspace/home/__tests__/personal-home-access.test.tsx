import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspacePoolPayload } from "@/lib/pool/types";
import type { TimelinePage } from "@/lib/workspace/timeline";

const driver = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0,
  effects: [] as (() => void | (() => void))[], news: vi.fn(), timeline: vi.fn(),
}));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = driver.cursor++;
    if (!(index in driver.states)) driver.states[index] = typeof initial === "function" ? initial() : initial;
    return [driver.states[index], (value: unknown) => { driver.states[index] = typeof value === "function" ? value(driver.states[index]) : value; }];
  },
  useRef: (initial: unknown) => driver.refs[driver.refCursor++] ??= { current: initial },
  useEffect: (effect: () => void | (() => void)) => { driver.effects.push(effect); },
}));
vi.mock("@/lib/reading/client", () => ({ fetchReadingHome: driver.news, READING_ITEMS_CHANGED: "reading-changed" }));
vi.mock("@/lib/workspace/timeline-client", async (original) => ({ ...await original<typeof import("@/lib/workspace/timeline-client")>(), fetchWorkspaceTimeline: driver.timeline, refreshWorkspaceTimeline: driver.timeline }));
vi.mock("@/lib/pool/store", () => ({ addPost: vi.fn() }));
vi.mock("../HomeNews", () => ({ poolPostFor: vi.fn() }));
import { PersonalHome } from "../PersonalHome";
import { HomeSession } from "../session";
import { TimelineAccessError } from "@/lib/workspace/timeline-client";

const post = { id: "private", blogId: "workspace", slug: "private", title: "Private draft", type: "note", status: "draft", createdAt: "2026-09-21", updatedAt: "2026-09-21" } as const;
const snapshot: TimelinePage = { entries: [{ id: post.id, at: post.createdAt, kind: "created", post }], nextCursor: null, snapshot: post.createdAt };
const pool = { blog: { handle: "workspace" }, blogId: "workspace", posts: [post] } as WorkspacePoolPayload;
function render(session: HomeSession) {
  driver.cursor = 0; driver.refCursor = 0; driver.effects = [];
  return renderToStaticMarkup(<PersonalHome pool={pool} capture={<button>Capture thought</button>} onOpenPost={vi.fn()} session={session} />);
}
beforeEach(() => {
  driver.states = []; driver.refs = []; driver.news.mockReset(); driver.timeline.mockReset();
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

it("restores the single item list as soon as its timeline settles", async () => {
  const session = new HomeSession();
  driver.timeline.mockResolvedValue(snapshot);
  expect(render(session)).toContain('data-scroll-restore-pending="true"');
  const cleanups = driver.effects.map((effect) => effect());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(render(session)).toContain("Private draft");
  expect(render(session)).toContain('data-scroll-restore-pending="false"');
  cleanups.forEach((cleanup) => cleanup?.());
});

it.each([new TimelineAccessError(), new Error("Network unavailable")])("hides cached personal content only when access is denied: %s", async (failure) => {
  const session = new HomeSession();
  session.saveTimeline("all", snapshot);
  session.saveTimeline("writing", snapshot);
  driver.timeline.mockRejectedValue(failure);
  expect(render(session)).toContain("Private draft");
  const cleanups = driver.effects.map((effect) => effect());
  await new Promise((resolve) => setTimeout(resolve, 0));
  const html = render(session);
  if (failure instanceof TimelineAccessError) {
    expect(html).toContain("Workspace access is unavailable");
    expect(html).not.toContain("Private draft");
    expect(html).not.toContain("Capture thought");
    expect(session.getTimeline("writing")).toBeNull();
    driver.states = []; driver.refs = [];
    expect(render(session)).not.toContain("Private draft");
    driver.timeline.mockResolvedValue(snapshot);
    const retryCleanups = driver.effects.map((effect) => effect());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render(session)).toContain("Private draft");
    expect(session.accessDenied).toBe(false);
    retryCleanups.forEach((cleanup) => cleanup?.());
  } else {
    expect(html).toContain("Private draft");
    expect(html).toContain("Could not refresh reading");
    expect(session.getTimeline("writing")).toBe(snapshot);
  }
  cleanups.forEach((cleanup) => cleanup?.());
});
