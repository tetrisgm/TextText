// Compiling a collection's filters to SQL.
//
// Split out of collection-query.ts because it is the only part that touches
// drizzle, and collection-query is imported by FolderPage, which is a client
// component: one unused export was putting drizzle-orm's whole pg-core into
// the bundle of every workspace page. The in-memory half stays where it was,
// and the two must answer the same question the same way - see the note on
// the `eq` case.

import { sql, type SQL } from "drizzle-orm";
import type { CollectionFilter } from "@/lib/presentation/schema";
import { FIELD_PREFIX } from "@/lib/documents/collection-query";

const fieldId = (path: string) => path.slice(FIELD_PREFIX.length);

function escapeLike(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1");
}


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
      // An unset boolean is false, matching the in-memory rule: a row that has
      // never carried the flag satisfies "flag = false". Kept in step with
      // matchesFilter, or the same collection answers differently depending on
      // whether it was filtered in Postgres or in the browser.
      if (filter.value === false) {
        return sql`(${FIELDS} @> ${JSON.stringify({ [id]: false })}::jsonb OR NOT (${FIELDS} ? ${id}) OR ${FIELDS} -> ${id} = 'null'::jsonb)`;
      }
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


/** All filters ANDed, or null when the spec has none. */
export function fieldFilterSql(filters: CollectionFilter[]): SQL | null {
  if (filters.length === 0) return null;
  return filters
    .map(filterCondition)
    .reduce((all, condition) => sql`${all} AND ${condition}`);
}

