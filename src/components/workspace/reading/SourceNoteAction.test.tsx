import React, { type ReactElement } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { WorkspacePoolPayload } from "@/lib/pool/types";

const driver = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, operation: { current: null as unknown }, execute: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: () => {
    const index = driver.cursor++;
    return [driver.values[index], (value: unknown) => { driver.values[index] = value; }];
  },
  useRef: () => driver.operation,
}));
vi.mock("@/lib/ai/workspace-tool-client", () => ({ executeWorkspaceToolRequest: driver.execute }));
vi.mock("@/components/workspace/home/StoryActions", () => ({ StoryActions: "dialog" }));
import { SourceNoteAction } from "./SourceNoteAction";

const pool = { blog: { handle: "mira" }, posts: [
  { id: "source", slug: "source-slug", type: "bookmark", title: "Source" },
  { id: "article", type: "article", title: "Existing article" },
  { id: "custom", type: "note", title: "Book review", template: { id: "book-review", version: 1 } },
  { id: "rss", type: "article", origin: "feed", title: "Unsaved RSS" },
] } as WorkspacePoolPayload;
type Node = ReactElement<{ children?: React.ReactNode; onClick?: () => void; value?: string }>;
function nodes(node: React.ReactNode): Node[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : []);
}
function render() {
  driver.cursor = 0;
  return nodes(SourceNoteAction({ pool, sourceId: "source", title: "Source", sourcePath: "/source", onOpenNote: vi.fn() }));
}
async function save() {
  render().filter((node) => node.type === "button").at(-1)!.props.onClick!();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
beforeEach(() => {
  driver.values = ["Exact passage", "", false, null, null];
  driver.operation.current = null;
  driver.execute.mockReset();
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
});
afterEach(() => vi.unstubAllGlobals());

it("offers authored articles and custom documents but excludes source items", () => {
  expect(render().filter((node) => node.type === "option").map((node) => node.props.value))
    .toEqual(["", "new:article", "article", "custom"]);
});

it("creates an article draft with the quote and retained internal source reference", async () => {
  driver.values[1] = "new:article";
  driver.execute.mockResolvedValue({ item: { id: "draft" } });
  await save();
  expect(driver.execute).toHaveBeenCalledWith("mira", "create_item", expect.objectContaining({
    kind: "article", template_id: "texttext.article", template_version: 1,
    body: "> Exact passage\n\nSource: [[source-slug|Source]]",
  }));
  expect(driver.values[4]).toBe("draft");
});

it("appends to an existing article and reuses the operation identity after failure", async () => {
  driver.values[1] = "article";
  driver.execute.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ item: { id: "article" } });
  await save();
  await save();
  expect(driver.execute.mock.calls[0]).toEqual(driver.execute.mock.calls[1]);
  expect(driver.execute.mock.calls[1]).toEqual(["mira", "append_to_item", expect.objectContaining({ id: "article", markdown: "> Exact passage\n\nSource: [[source-slug|Source]]" })]);
  expect(driver.values[4]).toBe("article");
});
