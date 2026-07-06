// Declarative mode specs: how a folder presents its items, as pure data.
//
// A ModeSpec names the views a folder mode offers (timeline, grid, list...),
// how each view sorts, and which item kinds the mode holds. This is the
// substrate AI-generated view specs are expressed in, so the contract is
// strict: a spec is ALWAYS validated data and NEVER executable code. Every
// spec that enters the system goes through validateModeSpec, which rejects
// unknown keys outright because tolerated extras are how spec injection
// starts.

import type { Folder, FolderMode, ItemKind } from "@/lib/content";

export type ViewPrimitive = "timeline" | "grid" | "index" | "single" | "list";
export type SortField = "publishedAt" | "updatedAt" | "createdAt" | "title";
export type SortDirection = "asc" | "desc";

export interface ViewSort {
  field: SortField;
  direction: SortDirection;
}

export interface ViewSpec {
  id: string;
  type: ViewPrimitive;
  label: string;
  sort?: ViewSort[];
}

export interface ModeSpec {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  itemKinds: ItemKind[];
  views: ViewSpec[];
  defaultViewId: string;
}

export const VIEW_PRIMITIVES = [
  "timeline",
  "grid",
  "index",
  "single",
  "list",
] as const satisfies readonly ViewPrimitive[];

export const SORT_FIELDS = [
  "publishedAt",
  "updatedAt",
  "createdAt",
  "title",
] as const satisfies readonly SortField[];

const SORT_DIRECTIONS = ["asc", "desc"] as const satisfies readonly SortDirection[];

// Mirrors the ItemKind union in content.ts. Kept as a value list so the
// validator can name the full vocabulary in its error message.
const ITEM_KINDS = [
  "article",
  "media_post",
  "video_post",
  "note",
  "bookmark",
  "feed_item",
  "group_post",
] as const satisfies readonly ItemKind[];

const MODE_SPEC_KEYS = new Set([
  "schemaVersion",
  "id",
  "name",
  "description",
  "itemKinds",
  "views",
  "defaultViewId",
]);
const VIEW_SPEC_KEYS = new Set(["id", "type", "label", "sort"]);
const SORT_RULE_KEYS = new Set(["field", "direction"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isViewPrimitive(value: unknown): value is ViewPrimitive {
  return (
    typeof value === "string" &&
    (VIEW_PRIMITIVES as readonly string[]).includes(value)
  );
}

function isSortField(value: unknown): value is SortField {
  return (
    typeof value === "string" && (SORT_FIELDS as readonly string[]).includes(value)
  );
}

function isSortDirection(value: unknown): value is SortDirection {
  return (
    typeof value === "string" &&
    (SORT_DIRECTIONS as readonly string[]).includes(value)
  );
}

function isItemKind(value: unknown): value is ItemKind {
  return (
    typeof value === "string" && (ITEM_KINDS as readonly string[]).includes(value)
  );
}

function requireText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be non-empty text`);
  }
  return value;
}

function validateItemKinds(value: unknown): ItemKind[] {
  if (!Array.isArray(value)) throw new Error("itemKinds must be a list");
  if (value.length === 0) {
    throw new Error("itemKinds must name at least one kind");
  }
  return value.map((entry, index) => {
    if (!isItemKind(entry)) {
      throw new Error(
        `itemKinds[${index}] must be one of ${ITEM_KINDS.join(", ")}`,
      );
    }
    return entry;
  });
}

function validateSort(value: unknown, path: string): ViewSort[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be a list`);
  return value.map((entry, index) => {
    const rulePath = `${path}[${index}]`;
    if (!isRecord(entry)) throw new Error(`${rulePath} must be an object`);
    for (const key of Object.keys(entry)) {
      if (!SORT_RULE_KEYS.has(key)) {
        throw new Error(`${rulePath}.${key} is not a recognized sort key`);
      }
    }
    if (!isSortField(entry.field)) {
      throw new Error(
        `${rulePath}.field must be one of ${SORT_FIELDS.join(", ")}`,
      );
    }
    if (!isSortDirection(entry.direction)) {
      throw new Error(`${rulePath}.direction must be "asc" or "desc"`);
    }
    return { field: entry.field, direction: entry.direction };
  });
}

function validateViews(value: unknown): ViewSpec[] {
  if (!Array.isArray(value)) throw new Error("views must be a list");
  if (value.length === 0) throw new Error("views must have at least one view");
  const seenIds = new Set<string>();
  return value.map((entry, index) => {
    const path = `views[${index}]`;
    if (!isRecord(entry)) throw new Error(`${path} must be an object`);
    for (const key of Object.keys(entry)) {
      if (!VIEW_SPEC_KEYS.has(key)) {
        throw new Error(`${path}.${key} is not a recognized view key`);
      }
    }
    const id = requireText(entry.id, `${path}.id`);
    if (seenIds.has(id)) {
      throw new Error(`${path}.id "${id}" repeats an earlier view id`);
    }
    seenIds.add(id);
    if (!isViewPrimitive(entry.type)) {
      throw new Error(
        `${path}.type must be one of ${VIEW_PRIMITIVES.join(", ")}`,
      );
    }
    const view: ViewSpec = {
      id,
      type: entry.type,
      label: requireText(entry.label, `${path}.label`),
    };
    if (entry.sort !== undefined) {
      view.sort = validateSort(entry.sort, `${path}.sort`);
    }
    return view;
  });
}

/**
 * Validate an untrusted value into a ModeSpec, or throw an Error naming the
 * exact path that failed (e.g. 'views[2].type must be one of ...'). Returns a
 * fresh object built only from recognized keys, so the result never carries
 * anything the validator did not look at.
 */
export function validateModeSpec(value: unknown): ModeSpec {
  if (!isRecord(value)) throw new Error("mode spec must be an object");
  for (const key of Object.keys(value)) {
    if (!MODE_SPEC_KEYS.has(key)) {
      throw new Error(`${key} is not a recognized mode spec key`);
    }
  }
  if (value.schemaVersion !== 1) {
    throw new Error(
      `schemaVersion must be 1 (got ${JSON.stringify(value.schemaVersion)}); this build only understands mode spec schema version 1`,
    );
  }
  const spec: ModeSpec = {
    schemaVersion: 1,
    id: requireText(value.id, "id"),
    name: requireText(value.name, "name"),
    itemKinds: validateItemKinds(value.itemKinds),
    views: validateViews(value.views),
    defaultViewId: requireText(value.defaultViewId, "defaultViewId"),
  };
  if (value.description !== undefined) {
    if (typeof value.description !== "string") {
      throw new Error("description must be text");
    }
    spec.description = value.description;
  }
  if (!spec.views.some((view) => view.id === spec.defaultViewId)) {
    throw new Error(
      `defaultViewId "${spec.defaultViewId}" does not match any view id`,
    );
  }
  return spec;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const NEWEST_PUBLISHED_FIRST: ViewSort[] = [
  { field: "publishedAt", direction: "desc" },
];

// The built-in specs. Each one is fed through validateModeSpec at module
// init, so a typo here fails the first import (and the test suite) instead
// of shipping a spec that hand-written data would be rejected for. View ids
// in the blog mode are the BlogHomeLayout values, so a blog's homeLayout is
// directly a valid view id. Deep-frozen because modeForFolder hands out the
// same objects to every caller.
export const SYSTEM_MODES: Record<FolderMode, ModeSpec> = deepFreeze({
  blog: validateModeSpec({
    schemaVersion: 1,
    id: "system.blog",
    name: "Blog",
    description: "Public writing: articles, media posts, and video posts.",
    itemKinds: ["article", "media_post", "video_post"],
    views: [
      {
        id: "timeline",
        type: "timeline",
        label: "Timeline",
        sort: NEWEST_PUBLISHED_FIRST,
      },
      {
        id: "grid",
        type: "grid",
        label: "Grid",
        sort: NEWEST_PUBLISHED_FIRST,
      },
      {
        id: "index",
        type: "index",
        label: "Index",
        sort: NEWEST_PUBLISHED_FIRST,
      },
      {
        id: "single",
        type: "single",
        label: "Single",
        sort: NEWEST_PUBLISHED_FIRST,
      },
    ],
    defaultViewId: "grid",
  }),
  notes: validateModeSpec({
    schemaVersion: 1,
    id: "system.notes",
    name: "Notes",
    description: "Private notes, always unlisted, freshest thinking first.",
    itemKinds: ["note"],
    views: [
      {
        id: "list",
        type: "list",
        label: "Notes",
        sort: [{ field: "updatedAt", direction: "desc" }],
      },
    ],
    defaultViewId: "list",
  }),
  bookmarks: validateModeSpec({
    schemaVersion: 1,
    id: "system.bookmarks",
    name: "Bookmarks",
    description: "Private saved links, always unlisted, newest saves first.",
    itemKinds: ["bookmark"],
    views: [
      {
        id: "list",
        type: "list",
        label: "Bookmarks",
        sort: [{ field: "createdAt", direction: "desc" }],
      },
    ],
    defaultViewId: "list",
  }),
});

/**
 * The mode spec for a folder. Folder modes come out of the database as
 * strings, so an unknown or stale mode falls back to the blog spec, the same
 * posture as cleanFolderMode in store.ts.
 */
export function modeForFolder(folder: Pick<Folder, "mode">): ModeSpec {
  const spec = SYSTEM_MODES[folder.mode] as ModeSpec | undefined;
  return spec ?? SYSTEM_MODES.blog;
}
