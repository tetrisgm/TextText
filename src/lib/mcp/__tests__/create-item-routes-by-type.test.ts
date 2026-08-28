import { describe, expect, it } from "vitest";

/**
 * An item goes where its type lives.
 *
 * `create_item` chose a destination from `kind`, a closed list of five, and
 * resolved `template_id` afterwards. So the thing an item actually IS never
 * influenced where it landed. That is the wrong shape for a product whose item
 * types are designed by the assistant: ask for a recipe and a recipe type gets
 * made, but the create still routes as if the only kinds were the built-in
 * five, and the recipe lands in Blog or Notes by accident of its `kind`.
 *
 * The folder using a type is the folder that type was made for, so finding it
 * needs no table mapping kinds to folders.
 */
type Folder = { path: string; defaultTemplate?: { id: string } | null };

/** The rule as implemented in the create_item case, isolated for testing. */
function destinationForType(
  folders: readonly Folder[],
  templateId: string | undefined,
): string | undefined {
  if (!templateId) return undefined;
  return folders.find((folder) => folder.defaultTemplate?.id === templateId)
    ?.path;
}

const FOLDERS: Folder[] = [
  { path: "blog", defaultTemplate: { id: "texttext.article" } },
  { path: "notes", defaultTemplate: { id: "texttext.note" } },
  { path: "notes/running", defaultTemplate: { id: "runs-9eef4c" } },
  { path: "recipes", defaultTemplate: { id: "custom.recipe" } },
  { path: "scratch", defaultTemplate: null },
];

describe("create_item routes by the item's type", () => {
  it("sends an assistant-invented type to the folder made for it", () => {
    expect(destinationForType(FOLDERS, "runs-9eef4c")).toBe("notes/running");
    expect(destinationForType(FOLDERS, "custom.recipe")).toBe("recipes");
  });

  it("works for built-in types too, with no special case", () => {
    expect(destinationForType(FOLDERS, "texttext.note")).toBe("notes");
    expect(destinationForType(FOLDERS, "texttext.article")).toBe("blog");
  });

  it("falls through when the type has no folder yet", () => {
    // Not an error: the caller may name a folder, or the kind fallback runs.
    expect(destinationForType(FOLDERS, "custom.unplaced")).toBeUndefined();
  });

  it("falls through when no type was given at all", () => {
    expect(destinationForType(FOLDERS, undefined)).toBeUndefined();
  });

  it("ignores folders with no look of their own", () => {
    expect(destinationForType([{ path: "scratch" }], "anything")).toBeUndefined();
  });
});
