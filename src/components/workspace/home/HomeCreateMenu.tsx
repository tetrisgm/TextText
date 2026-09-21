"use client";

import type { WorkspacePoolPayload } from "@/lib/pool/types";
import type { FolderCreateItem } from "../UniversalItemComposer";

export function HomeCreateMenu({ pool, onCreateItem, onBuildItemType, heading = "Home", headingId }: {
  heading?: string;
  headingId?: string;
  pool: WorkspacePoolPayload;
  onCreateItem?: FolderCreateItem;
  onBuildItemType: () => void;
}) {
  const templates = [...new Map([...pool.templates].sort((a, b) => a.version - b.version)
    .map((template) => [template.id, template])).values()]
    .filter((template) => !template.id.startsWith("texttext."));
  const create = (id: string) => {
    const type = id === "texttext.article" ? "article" : id === "texttext.bookmark" ? "bookmark" : "note";
    const mode = type === "article" ? "blog" : type === "bookmark" ? "bookmarks" : "notes";
    const folder = pool.folders.find((entry) => entry.defaultTemplate?.id === id)
      ?? pool.folders.find((entry) => entry.path === mode)
      ?? pool.folders.find((entry) => entry.mode === mode)
      ?? pool.folders[0];
    if (!folder) return;
    const template = { id, version: templates.find((entry) => entry.id === id)?.version ?? 1 };
    if (type === "bookmark") onCreateItem?.({ type, blank: true, folderPath: folder.path, template });
    else onCreateItem?.({ type, folderPath: folder.path, template });
  };
  return <div className="personal-home-create">
    <h1 id={headingId}>{heading}</h1>
    <select aria-label="Create a new item" value="" disabled={!onCreateItem || !pool.folders.length} onChange={(event) => create(event.currentTarget.value)}>
      <option value="" disabled>New…</option>
      <option value="texttext.note">Note</option>
      <option value="texttext.article">Article</option>
      <option value="texttext.bookmark">Bookmark</option>
      {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
    </select>
    <button type="button" onClick={() => onBuildItemType()}>New type</button>
  </div>;
}
