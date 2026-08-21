import { describe, expect, it } from "vitest";
import type { Folder } from "@/lib/content";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import {
  normalizeSearchText,
  parseWorkspaceDateQuery,
  rankSearchText,
  searchWorkspace,
  workspaceRootBodyMode,
  workspaceSearchHandoffIndex,
} from "@/lib/workspace-search";

const folders: Folder[] = [
  { id: "notes", name: "Notes", path: "notes", mode: "notes", position: 0 },
];

function post(
  id: string,
  title: string,
  createdAt: string,
  options: Partial<WorkspacePoolPost> = {},
): WorkspacePoolPost {
  return {
    id,
    blogId: "workspace-1",
    type: "note",
    slug: id,
    title,
    status: "draft",
    createdAt,
    updatedAt: createdAt,
    ...options,
  };
}

describe("workspace search", () => {
  it("uses search results as the home body and hands arrow focus into it", () => {
    expect(workspaceRootBodyMode("")).toBe("home");
    expect(workspaceRootBodyMode("cedar")).toBe("search");
    expect(
      workspaceRootBodyMode("2026-07-13", new Date(2026, 6, 17, 12)),
    ).toBe("date");
    expect(workspaceSearchHandoffIndex(4, "down")).toBe(0);
    expect(workspaceSearchHandoffIndex(4, "up")).toBe(3);
    expect(workspaceSearchHandoffIndex(0, "down")).toBeNull();
  });

  it("ranks title matches before excerpts, previews, and hydrated bodies", () => {
    const results = searchWorkspace({
      folders,
      posts: [
        post("body", "Weekly plan", "2026-07-11T12:00:00.000Z"),
        post("preview", "Another item", "2026-07-12T12:00:00.000Z", {
          bodyPreview: "Project cedar notes",
        }),
        post("title", "Cedar roadmap", "2026-07-13T12:00:00.000Z"),
      ],
      bodies: { body: "The cedar launch checklist" },
      query: "cedar",
    });

    expect(results[0]?.id).toBe("post:title");
    expect(new Set(results.slice(1).map((result) => result.id))).toEqual(
      new Set(["post:preview", "post:body"]),
    );
  });

  it("finds a remembered note when normalized query tokens are separated", () => {
    expect(normalizeSearchText("  Launch-brief: Évidence  ")).toBe(
      "launch brief evidence",
    );
    expect(
      rankSearchText(
        "Planning note",
        "Evidence to collect after the launch owner revises the brief.",
        "launch brief evidence",
      ),
    ).not.toBeNull();

    const results = searchWorkspace({
      folders,
      posts: [
        post("match", "Planning note", "2026-07-13T12:00:00.000Z", {
          bodyPreview:
            "Evidence to collect after the launch owner revises the brief.",
        }),
        post("partial", "Launch brief", "2026-07-14T12:00:00.000Z", {
          bodyPreview: "Ready to share.",
        }),
      ],
      query: "launch brief evidence",
    });

    expect(results.map((result) => result.id)).toEqual(["post:match"]);
  });

  it("keeps exact title matches ahead of token-only body matches", () => {
    const results = searchWorkspace({
      folders,
      posts: [
        post("tokens", "Planning note", "2026-07-14T12:00:00.000Z", {
          bodyPreview: "Evidence follows the launch brief.",
        }),
        post(
          "title",
          "Launch brief evidence",
          "2026-07-13T12:00:00.000Z",
        ),
      ],
      query: "launch brief evidence",
    });

    expect(results.map((result) => result.id)).toEqual([
      "post:title",
      "post:tokens",
    ]);
  });

  it("parses named and ISO dates and rejects impossible dates", () => {
    const now = new Date(2026, 6, 17, 12);
    expect(parseWorkspaceDateQuery("jul 13", now)).toBe("2026-07-13");
    expect(parseWorkspaceDateQuery("July 13, 2025", now)).toBe("2025-07-13");
    expect(parseWorkspaceDateQuery("2026-07-13", now)).toBe("2026-07-13");
    expect(parseWorkspaceDateQuery("2026-02-30", now)).toBeNull();
  });

  it("returns items created or edited on the requested local day once", () => {
    const results = searchWorkspace({
      folders,
      posts: [
        post("day", "Created that day", "2026-07-13T18:00:00.000Z"),
        post("edited", "Edited that day", "2026-07-12T18:00:00.000Z", {
          updatedAt: "2026-07-13T20:00:00.000Z",
        }),
        post("other", "Created later", "2026-07-14T18:00:00.000Z"),
      ],
      query: "2026-07-13",
    });
    expect(results.map((result) => result.id)).toEqual([
      "post:edited",
      "post:day",
    ]);
  });
});
