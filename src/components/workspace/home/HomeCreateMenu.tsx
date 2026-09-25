"use client";

import type { WorkspacePoolPayload } from "@/lib/pool/types";
import type { FolderCreateItem } from "../UniversalItemComposer";

export function HomeCreateMenu({ pool, onCreateItem, heading = "Home", headingId }: {
  heading?: string;
  headingId?: string;
  pool: WorkspacePoolPayload;
  onCreateItem?: FolderCreateItem;
  onBuildItemType: () => void;
}) {
  const create = () => {
    const folder = pool.folders.find((entry) => entry.path === "notes")
      ?? pool.folders.find((entry) => entry.mode === "notes")
      ?? pool.folders[0];
    if (!folder) return;
    onCreateItem?.({ type: "note", folderPath: folder.path });
  };
  return <div className="personal-home-create">
    <h1 id={headingId}>{heading}</h1>
    <button type="button" disabled={!onCreateItem || !pool.folders.length} onClick={create}>Write a note</button>
  </div>;
}
