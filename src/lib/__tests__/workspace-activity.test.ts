import { describe, expect, it } from "vitest";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import {
  calendarDocumentAction,
  groupDocumentsByCreatedDate,
  readWorkspaceDocumentOpenHistory,
  sortSidebarDocuments,
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
    storage.setItem("write:workspace-document-opens:workspace-1", "not-json");
    expect(readWorkspaceDocumentOpenHistory("workspace-1", storage)).toEqual(
      {},
    );
  });

  it("opens a single calendar document and filters when a date has several", () => {
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
      kind: "filter",
      dateKey: "2026-07-10",
      postIds: ["opened", "same-day"],
    });
    expect(calendarDocumentAction("2026-07-11", [newlyEdited])).toEqual({
      kind: "open",
      postId: "edited",
    });
  });
});
