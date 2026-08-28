import { describe, expect, it } from "vitest";

import { resolveDocumentVisibility } from "@/lib/documents/visibility";

/**
 * Visibility is decided by the FOLDER, not by a fixed list of item kinds.
 *
 * The old rule asked whether the item's type was "note" or "bookmark". That
 * only works while the set of kinds is closed, and it is not: item types are
 * created by the assistant, so a workspace can hold kinds nobody has named
 * yet. "Is a runs-9eef4c private?" has no answer. "Is the folder it lives in
 * private?" always does.
 *
 * Fail closed everywhere. An unknown folder is private, a missing request is
 * private, and a private folder overrides an explicit request to publish.
 */
describe("visibility resolves from the folder", () => {
  it("is private when nothing is known", () => {
    expect(resolveDocumentVisibility({})).toBe("private");
  });

  it("is private when the folder is unknown, whatever was asked for", () => {
    expect(resolveDocumentVisibility({ requested: "public" })).toBe("private");
  });

  it("keeps a private folder private even when public is requested", () => {
    for (const folderMode of ["notes", "bookmarks"] as const) {
      expect(
        resolveDocumentVisibility({ requested: "public", folderMode }),
      ).toBe("private");
      expect(
        resolveDocumentVisibility({ existing: "public", folderMode }),
      ).toBe("private");
    }
  });

  it("lets a blog folder carry what was asked for", () => {
    expect(
      resolveDocumentVisibility({ requested: "public", folderMode: "blog" }),
    ).toBe("public");
    expect(
      resolveDocumentVisibility({ requested: "link", folderMode: "blog" }),
    ).toBe("link");
  });

  it("falls back to what was already stored, then to private", () => {
    expect(
      resolveDocumentVisibility({ existing: "public", folderMode: "blog" }),
    ).toBe("public");
    expect(resolveDocumentVisibility({ folderMode: "blog" })).toBe("private");
  });

  it("does not care what the item kind is called", () => {
    // The whole point: a kind the assistant invented resolves the same way as
    // a built-in one, because the folder is what is being asked.
    expect(
      resolveDocumentVisibility({ requested: "public", folderMode: "notes" }),
    ).toBe("private");
    expect(
      resolveDocumentVisibility({ requested: "public", folderMode: "blog" }),
    ).toBe("public");
  });

  /**
   * A deliberate change, recorded so it is not mistaken for a leak.
   *
   * The old rule made a note private forever, wherever it went, because its
   * TYPE said note. The new rule says the folder decides, so a note moved into
   * Blog can then be published. That takes two explicit acts, moving it and
   * then saving it public, and "notes stay unlisted" still holds: an item that
   * has been moved out of Notes is not in Notes any more.
   *
   * Moving alone publishes nothing. setPostFolder changes folderId and leaves
   * visibility as it was, so the item stays private until someone asks for it
   * to be public.
   */
  it("lets a moved item follow its new folder, and only when asked", () => {
    // In Notes: private, whatever is requested.
    expect(
      resolveDocumentVisibility({ requested: "public", folderMode: "notes" }),
    ).toBe("private");
    // Moved to Blog, nothing else asked for: still private.
    expect(
      resolveDocumentVisibility({ existing: "private", folderMode: "blog" }),
    ).toBe("private");
    // Moved to Blog and explicitly published: public.
    expect(
      resolveDocumentVisibility({
        requested: "public",
        existing: "private",
        folderMode: "blog",
      }),
    ).toBe("public");
  });
});
