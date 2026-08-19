export type WorkspaceReferenceChoice = {
  id: string;
  label: string;
  description?: string;
};

type WorkspaceItemChoiceSource = {
  id: string;
  title: string;
  type: string;
};

const typeLabel = (type: string): string =>
  type
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

/** Canonical active workspace items, shaped for reference-field pickers. */
export function workspaceReferenceChoices(
  posts: readonly WorkspaceItemChoiceSource[],
  currentId?: string,
): WorkspaceReferenceChoice[] {
  return posts
    .filter((post) => post.id !== currentId)
    .map((post) => ({
      id: post.id,
      label: post.title.trim() || "Untitled",
      description: typeLabel(post.type),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

