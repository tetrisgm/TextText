import { describe, expect, it } from "vitest";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import {
  calendarDaysForMonth,
  calendarDocumentAction,
  documentsForActivityDate,
  groupDocumentsByActivityDate,
  groupDocumentsByCreatedDate,
  readWorkspaceDocumentOpenHistory,
  sortSidebarDocuments,
  sortWorkspaceFoldersByActivity,
  writeWorkspaceDocumentOpen,
} from "@/lib/workspace-activity";

function post(
  id: string,
  title: string,
  createdAt: string,
  updatedAt: string,
): WorkspacePoolPost {
  return {
    id,
    blogId: "workspace-1",
    type: "note",
    slug: id,
    title,
    status: "draft",
    createdAt,
    updatedAt,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("workspace activity", () => {
  const olderButOpened = post(
    "opened",
    "Opened",
    "2026-07-10T08:00:00.000Z",
    "2026-07-10T09:00:00.000Z",
  );
  const newlyEdited = post(
    "edited",
    "Edited",
    "2026-07-11T08:00:00.000Z",
    "2026-07-14T09:00:00.000Z",
  );

  it("keeps recently opened ordering distinct from last edited", () => {
    const documents = [olderButOpened, newlyEdited];
    expect(sortSidebarDocuments(documents, "edited", {})).toEqual([
      newlyEdited,
      olderButOpened,
    ]);
    expect(
      sortSidebarDocuments(documents, "recent", { opened: 100, edited: 50 }),
    ).toEqual([olderButOpened, newlyEdited]);
  });

  it("persists valid open history without trusting malformed storage", () => {
    const storage = memoryStorage();
    writeWorkspaceDocumentOpen("workspace-1", "opened", 100, storage);
    writeWorkspaceDocumentOpen("workspace-1", "edited", 200, storage);
    expect(readWorkspaceDocumentOpenHistory("workspace-1", storage)).toEqual({
      edited: 200,
      opened: 100,
    });
    storage.setItem("texttext:workspace-document-opens:workspace-1", "not-json");
    expect(readWorkspaceDocumentOpenHistory("workspace-1", storage)).toEqual(
      {},
    );
  });

  it("turns every calendar day into a date search", () => {
    const sameDay = post(
      "same-day",
      "Same day",
      "2026-07-10T18:00:00.000Z",
      "2026-07-10T18:00:00.000Z",
    );
    const byDate = groupDocumentsByCreatedDate([olderButOpened, sameDay]);
    const matches = [...byDate.values()].find(
      (entries) => entries.length === 2,
    );
    expect(matches).toBeDefined();
    expect(calendarDocumentAction("2026-07-10", matches ?? [])).toEqual({
      kind: "search",
      dateKey: "2026-07-10",
      postIds: ["opened", "same-day"],
    });
    expect(calendarDocumentAction("2026-07-11", [newlyEdited])).toEqual({
      kind: "search",
      dateKey: "2026-07-11",
      postIds: ["edited"],
    });
    expect(calendarDocumentAction("2026-07-12", [])).toEqual({
      kind: "search",
      dateKey: "2026-07-12",
      postIds: [],
    });
  });

  it("renders only calendar weeks that contain a day in the month", () => {
    expect(calendarDaysForMonth(new Date(2021, 1, 1))).toHaveLength(28);
    expect(calendarDaysForMonth(new Date(2026, 3, 1))).toHaveLength(35);
    expect(calendarDaysForMonth(new Date(2026, 7, 1))).toHaveLength(42);
  });

  it("splits a date into created and edited sections without duplicates", () => {
    const createdAndEdited = post(
      "same",
      "Same day",
      "2026-07-13T08:00:00.000Z",
      "2026-07-13T18:00:00.000Z",
    );
    const editedOnly = post(
      "edited-only",
      "Edited only",
      "2026-07-10T08:00:00.000Z",
      "2026-07-13T12:00:00.000Z",
    );
    const activity = documentsForActivityDate(
      [createdAndEdited, editedOnly],
      "2026-07-13",
    );
    expect(activity.created.map((entry) => entry.id)).toEqual(["same"]);
    expect(activity.edited.map((entry) => entry.id)).toEqual(["edited-only"]);
    expect(
      groupDocumentsByActivityDate([createdAndEdited, editedOnly]).get(
        "2026-07-13",
      )?.map((entry) => entry.id),
    ).toEqual(["same", "edited-only"]);
  });

  it("orders root folders by the selected document activity sort", () => {
    const folders = [
      {
        id: "blog",
        name: "Blog",
        path: "blog",
        mode: "blog" as const,
        position: 0,
      },
      {
        id: "notes",
        name: "Notes",
        path: "notes",
        mode: "notes" as const,
        position: 1,
      },
    ];
    const nested = {
      id: "ideas",
      name: "Ideas",
      path: "blog/ideas",
      mode: "blog" as const,
      parentId: "blog",
      position: 0,
    };
    const article = {
      ...olderButOpened,
      id: "article",
      type: "article" as const,
      folderId: "ideas",
    };
    const note = { ...newlyEdited, id: "note", folderId: "notes" };
    expect(
      sortWorkspaceFoldersByActivity(folders, [article, note], "recent", {
        article: Date.parse("2026-07-16T12:00:00.000Z"),
        note: Date.parse("2026-07-15T12:00:00.000Z"),
      }, [...folders, nested]).map((folder) => folder.id),
    ).toEqual(["blog", "notes"]);
    expect(
      sortWorkspaceFoldersByActivity(
        folders,
        [article, note],
        "edited",
        {},
        [...folders, nested],
      ).map((folder) => folder.id),
    ).toEqual(["notes", "blog"]);
  });
});
