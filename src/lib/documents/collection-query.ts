// Query documents by their custom fields.
//
// A template's collection spec can declare filters and sort keys over
// `content.fields.<id>` (src/lib/presentation/schema.ts). This module is the
// single translation of that declarative spec into execution, in both places
// execution happens:
//
//   - `fieldFilterSql` compiles filters to SQL over posts.document, using jsonb
//     containment and existence so the GIN index from
//     scripts/migrate-add-document-fields-index.mjs serves them.
//   - `applyCollectionSpec` applies the same filters and sort in process, for
//     the demo store, the client pool, and the page of rows a filter returns.
//
// Both halves are pure over the same spec, so a template behaves identically
// against Postgres and against an in-memory pool. Keep them in lockstep: a new
// operator lands in BOTH or in neither.

import { sql, type SQL } from "drizzle-orm";
import type { CollectionFilter, CollectionRenderSpec } from "@/lib/presentation/schema";
import type { DocumentFieldValue } from "@/lib/documents/model";

const FIELD_PREFIX = "content.fields.";

const fieldId = (path: string) => path.slice(FIELD_PREFIX.length);

// ---------------------------------------------------------------------------
// SQL compilation
// ---------------------------------------------------------------------------

/** The jsonb object filters run against. */
const FIELDS = sql`(posts.document -> 'content' -> 'fields')`;

function scalarText(id: string): SQL {
  return sql`(${FIELDS} ->> ${id})`;
}

/**
 * One filter to one SQL condition. `eq` uses containment so the GIN
 * (jsonb_path_ops) index serves it; everything else is a cheap re-check on the
 * rows that survive.
 */
function filterCondition(filter: CollectionFilter): SQL {
  const id = fieldId(filter.field);
  switch (filter.op) {
    case "eq":
      return sql`${FIELDS} @> ${JSON.stringify({ [id]: filter.value })}::jsonb`;
    case "neq":
      return sql`(NOT (${FIELDS} @> ${JSON.stringify({ [id]: filter.value })}::jsonb) AND ${FIELDS} ? ${id})`;
    case "isSet":
      return sql`(${FIELDS} ? ${id} AND ${FIELDS} -> ${id} <> 'null'::jsonb)`;
    case "notSet":
      return sql`(NOT (${FIELDS} ? ${id}) OR ${FIELDS} -> ${id} = 'null'::jsonb)`;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const operator = { gt: sql`>`, gte: sql`>=`, lt: sql`<`, lte: sql`<=` }[filter.op];
      // Numbers compare numerically. Dates are ISO-8601 strings, which order
      // lexicographically, so text comparison is correct for them; the
      // validator only admits these ops on number and date fields.
      if (typeof filter.value === "number") {
        return sql`(jsonb_typeof(${FIELDS} -> ${id}) = 'number' AND (${scalarText(id)})::numeric ${operator} ${filter.value})`;
      }
      return sql`(jsonb_typeof(${FIELDS} -> ${id}) = 'string' AND ${scalarText(id)} ${operator} ${String(filter.value)})`;
    }
    case "contains":
      return sql`${scalarText(id)} ILIKE ${"%" + escapeLike(String(filter.value)) + "%"}`;
  }
}

function escapeLike(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1");
}

/** All filters ANDed, or null when the spec has none. */
export function fieldFilterSql(filters: CollectionFilter[]): SQL | null {
  if (filters.length === 0) return null;
  return filters
    .map(filterCondition)
    .reduce((all, condition) => sql`${all} AND ${condition}`);
}

// ---------------------------------------------------------------------------
// In-process application
// ---------------------------------------------------------------------------

/** The shape both the pool and the store rows can offer this module. */
export type CollectionQueryable = {
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  publishedAt?: string | Date | null;
  title?: string | null;
  fields: Record<string, DocumentFieldValue>;
};

function fieldValue(item: CollectionQueryable, id: string): DocumentFieldValue {
  return Object.prototype.hasOwnProperty.call(item.fields, id)
    ? item.fields[id]
    : null;
}

export function matchesFilter(
  item: CollectionQueryable,
  filter: CollectionFilter,
): boolean {
  const id = fieldId(filter.field);
  const value = fieldValue(item, id);
  switch (filter.op) {
    case "eq":
      return value === filter.value;
    case "neq":
      return value !== null && value !== filter.value;
    case "isSet":
      return value !== null;
    case "notSet":
      return value === null;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (value === null) return false;
      // Same rule as the SQL side: numbers numerically, ISO dates as text.
      const comparable =
        typeof filter.value === "number"
          ? typeof value === "number"
            ? value
            : null
          : typeof value === "string"
            ? value
            : null;
      if (comparable === null) return false;
      const other = filter.value as number | string;
      switch (filter.op) {
        case "gt":
          return comparable > other;
        case "gte":
          return comparable >= other;
        case "lt":
          return comparable < other;
        case "lte":
          return comparable <= other;
      }
    }
    case "contains":
      return (
        typeof value === "string" &&
        value.toLowerCase().includes(String(filter.value).toLowerCase())
      );
  }
}

const timestamp = (value: string | Date | null | undefined): number => {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

function sortKey(
  item: CollectionQueryable,
  field: string,
): number | string | null {
  switch (field) {
    case "createdAt":
      return timestamp(item.createdAt);
    case "updatedAt":
      return timestamp(item.updatedAt);
    case "publishedAt":
      return timestamp(item.publishedAt);
    case "title":
      return (item.title ?? "").toLowerCase();
    default: {
      const value = fieldValue(item, fieldId(field));
      if (value === null) return null;
      if (typeof value === "boolean") return value ? 1 : 0;
      if (Array.isArray(value)) return value.length;
      if (typeof value === "string") return value.toLowerCase();
      return value;
    }
  }
}

/** Missing values sort LAST regardless of direction: a Books folder sorted by
 * rating should not lead with the unrated. */
function compareKeys(
  a: number | string | null,
  b: number | string | null,
  direction: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let order: number;
  if (typeof a === "number" && typeof b === "number") {
    order = a - b;
  } else {
    order = String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  }
  return direction === "desc" ? -order : order;
}

export function applyCollectionSpec<T extends CollectionQueryable>(
  items: T[],
  spec: Pick<CollectionRenderSpec, "filters" | "sort">,
): T[] {
  const filtered =
    spec.filters.length === 0
      ? [...items]
      : items.filter((item) =>
          spec.filters.every((filter) => matchesFilter(item, filter)),
        );
  if (spec.sort.length === 0) return filtered;
  return filtered
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      for (const entry of spec.sort) {
        const order = compareKeys(
          sortKey(left.item, entry.field),
          sortKey(right.item, entry.field),
          entry.direction,
        );
        if (order !== 0) return order;
      }
      return left.index - right.index; // stable
    })
    .map(({ item }) => item);
}
