import { describe, expect, it } from "vitest";

import type { Folder } from "@/lib/content";
import {
  modeForFolder,
  SYSTEM_MODES,
  validateModeSpec,
  type ModeSpec,
} from "@/lib/modes";

/** A fully loaded, valid spec as plain untyped data, fresh per call. */
function validSpec(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "custom.reading-log",
    name: "Reading log",
    description: "Articles and bookmarks in one place.",
    itemKinds: ["article", "bookmark"],
    views: [
      {
        id: "latest",
        type: "list",
        label: "Latest",
        sort: [
          { field: "createdAt", direction: "desc" },
          { field: "title", direction: "asc" },
        ],
      },
      { id: "wall", type: "grid", label: "Wall" },
    ],
    defaultViewId: "latest",
  };
}

describe("validateModeSpec", () => {
  it("accepts a fully loaded spec and returns its data", () => {
    const spec = validateModeSpec(validSpec());
    expect(spec).toEqual(validSpec());
  });

  it("accepts a minimal spec without description or sort", () => {
    const spec = validateModeSpec({
      schemaVersion: 1,
      id: "m",
      name: "M",
      itemKinds: ["note"],
      views: [{ id: "only", type: "single", label: "Only" }],
      defaultViewId: "only",
    });
    expect(spec.description).toBeUndefined();
    expect(spec.views[0].sort).toBeUndefined();
  });

  it("returns a fresh object, not the input", () => {
    const input = validSpec();
    const spec = validateModeSpec(input);
    expect(spec).not.toBe(input);
    expect(spec.views).not.toBe(input.views);
    (input.views as unknown[]).length = 0;
    expect(spec.views).toHaveLength(2);
  });

  it("rejects non-object input", () => {
    for (const value of [null, undefined, "blog", 7, [validSpec()]]) {
      expect(() => validateModeSpec(value)).toThrow(
        "mode spec must be an object",
      );
    }
  });

  it("rejects a missing id by path", () => {
    const broken = validSpec();
    delete broken.id;
    expect(() => validateModeSpec(broken)).toThrow("id must be non-empty text");
  });

  it("rejects a blank name by path", () => {
    expect(() => validateModeSpec({ ...validSpec(), name: "   " })).toThrow(
      "name must be non-empty text",
    );
  });

  it("rejects schemaVersion 2 with a clear message", () => {
    expect(() => validateModeSpec({ ...validSpec(), schemaVersion: 2 })).toThrow(
      "schemaVersion must be 1 (got 2)",
    );
  });

  it("rejects a missing schemaVersion", () => {
    const broken = validSpec();
    delete broken.schemaVersion;
    expect(() => validateModeSpec(broken)).toThrow("schemaVersion must be 1");
  });

  it("rejects an unknown top-level key by name", () => {
    expect(() =>
      validateModeSpec({ ...validSpec(), onRender: "alert(1)" }),
    ).toThrow("onRender is not a recognized mode spec key");
  });

  it("rejects an unknown view-level key by path", () => {
    const broken = validSpec();
    (broken.views as Record<string, unknown>[])[1].template = "<script/>";
    expect(() => validateModeSpec(broken)).toThrow(
      "views[1].template is not a recognized view key",
    );
  });

  it("rejects an unknown sort-rule key by path", () => {
    const broken = validSpec();
    const view = (broken.views as Record<string, unknown>[])[0];
    (view.sort as Record<string, unknown>[])[1].comparator = "eval";
    expect(() => validateModeSpec(broken)).toThrow(
      "views[0].sort[1].comparator is not a recognized sort key",
    );
  });

  it("rejects empty views", () => {
    expect(() => validateModeSpec({ ...validSpec(), views: [] })).toThrow(
      "views must have at least one view",
    );
  });

  it("rejects non-list views", () => {
    expect(() =>
      validateModeSpec({ ...validSpec(), views: { id: "x" } }),
    ).toThrow("views must be a list");
  });

  it("rejects a bad view type by path", () => {
    const broken = validSpec();
    (broken.views as Record<string, unknown>[])[1].type = "carousel";
    expect(() => validateModeSpec(broken)).toThrow(
      "views[1].type must be one of timeline, grid, index, single, list",
    );
  });

  it("rejects a duplicate view id by path", () => {
    const broken = validSpec();
    (broken.views as Record<string, unknown>[])[1].id = "latest";
    expect(() => validateModeSpec(broken)).toThrow(
      'views[1].id "latest" repeats an earlier view id',
    );
  });

  it("rejects a bad sort field by path", () => {
    const broken = validSpec();
    const view = (broken.views as Record<string, unknown>[])[0];
    (view.sort as Record<string, unknown>[])[0].field = "views";
    expect(() => validateModeSpec(broken)).toThrow(
      "views[0].sort[0].field must be one of publishedAt, updatedAt, createdAt, title",
    );
  });

  it("rejects a bad sort direction by path", () => {
    const broken = validSpec();
    const view = (broken.views as Record<string, unknown>[])[0];
    (view.sort as Record<string, unknown>[])[1].direction = "up";
    expect(() => validateModeSpec(broken)).toThrow(
      'views[0].sort[1].direction must be "asc" or "desc"',
    );
  });

  it("rejects a dangling defaultViewId by name", () => {
    expect(() =>
      validateModeSpec({ ...validSpec(), defaultViewId: "ghost" }),
    ).toThrow('defaultViewId "ghost" does not match any view id');
  });

  it("rejects empty itemKinds", () => {
    expect(() => validateModeSpec({ ...validSpec(), itemKinds: [] })).toThrow(
      "itemKinds must name at least one kind",
    );
  });

  it("rejects an unknown item kind by path", () => {
    expect(() =>
      validateModeSpec({ ...validSpec(), itemKinds: ["article", "tweet"] }),
    ).toThrow(
      "itemKinds[1] must be one of article, media_post, video_post, note, bookmark, feed_item, group_post",
    );
  });
});

describe("SYSTEM_MODES", () => {
  it("every built-in spec passes validateModeSpec", () => {
    for (const spec of Object.values(SYSTEM_MODES)) {
      expect(() =>
        validateModeSpec(JSON.parse(JSON.stringify(spec))),
      ).not.toThrow();
    }
  });

  it("blog offers the four BlogHomeLayout views and defaults to grid", () => {
    const blog = SYSTEM_MODES.blog;
    expect(blog.views.map((view) => view.id).sort()).toEqual([
      "grid",
      "index",
      "single",
      "timeline",
    ]);
    expect(blog.defaultViewId).toBe("grid");
    expect(blog.itemKinds).toEqual(["article", "media_post", "video_post"]);
  });

  it("notes is a single list of notes, freshest edit first", () => {
    const notes = SYSTEM_MODES.notes;
    expect(notes.itemKinds).toEqual(["note"]);
    expect(notes.views).toHaveLength(1);
    expect(notes.views[0].type).toBe("list");
    expect(notes.views[0].sort).toEqual([
      { field: "updatedAt", direction: "desc" },
    ]);
    expect(notes.defaultViewId).toBe(notes.views[0].id);
  });

  it("bookmarks is a single list of bookmarks, newest save first", () => {
    const bookmarks = SYSTEM_MODES.bookmarks;
    expect(bookmarks.itemKinds).toEqual(["bookmark"]);
    expect(bookmarks.views).toHaveLength(1);
    expect(bookmarks.views[0].type).toBe("list");
    expect(bookmarks.views[0].sort).toEqual([
      { field: "createdAt", direction: "desc" },
    ]);
    expect(bookmarks.defaultViewId).toBe(bookmarks.views[0].id);
  });

  it("specs are frozen so shared state cannot be corrupted", () => {
    expect(Object.isFrozen(SYSTEM_MODES)).toBe(true);
    expect(Object.isFrozen(SYSTEM_MODES.blog)).toBe(true);
    expect(Object.isFrozen(SYSTEM_MODES.blog.views)).toBe(true);
    expect(Object.isFrozen(SYSTEM_MODES.blog.views[0])).toBe(true);
    expect(() => {
      (SYSTEM_MODES.blog as { defaultViewId: string }).defaultViewId = "single";
    }).toThrow();
  });
});

describe("modeForFolder", () => {
  it("maps each folder mode to its system spec", () => {
    expect(modeForFolder({ mode: "blog" })).toBe(SYSTEM_MODES.blog);
    expect(modeForFolder({ mode: "notes" })).toBe(SYSTEM_MODES.notes);
    expect(modeForFolder({ mode: "bookmarks" })).toBe(SYSTEM_MODES.bookmarks);
  });

  it("falls back to blog for unknown modes", () => {
    const stale = { mode: "scrapbook" as Folder["mode"] };
    const spec: ModeSpec = modeForFolder(stale);
    expect(spec).toBe(SYSTEM_MODES.blog);
  });
});
