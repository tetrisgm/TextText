// The declarative collection query, both halves.
//
// The SQL compiler and the in-process matcher must implement the SAME
// semantics, so most cases here run the in-process half over fixtures and
// separately assert the SQL shape (containment for eq, existence for isSet,
// numeric vs text comparison) rather than duplicating a live database.

import { describe, expect, it } from "vitest";
import {
  applyCollectionSpec,
  matchesFilter,
  type CollectionQueryable,
} from "../collection-query";
import { fieldFilterSql } from "../collection-query.server";
import type { CollectionFilter } from "@/lib/presentation/schema";

const book = (
  title: string,
  fields: Record<string, string | number | boolean | null | string[]>,
  updatedAt = "2026-07-01T00:00:00Z",
): CollectionQueryable => ({ title, updatedAt, fields });

const shelf = [
  book("Dune", { rating: 5, status: "read", finishedOn: "2026-03-01" }),
  book("Blindsight", { rating: 4, status: "read", finishedOn: "2026-06-10" }),
  book("Piranesi", { rating: null, status: "reading" }),
  book("Ulysses", { status: "abandoned" }),
];

const filter = (partial: Partial<CollectionFilter> & { op: CollectionFilter["op"] }): CollectionFilter =>
  ({ field: "content.fields.rating", ...partial }) as CollectionFilter;

describe("matchesFilter", () => {
  it("eq matches the exact scalar", () => {
    expect(matchesFilter(shelf[0], filter({ op: "eq", value: 5 }))).toBe(true);
    expect(matchesFilter(shelf[1], filter({ op: "eq", value: 5 }))).toBe(false);
  });

  it("neq excludes unset values rather than matching them", () => {
    const f = filter({ field: "content.fields.status", op: "neq", value: "read" });
    expect(matchesFilter(shelf[2], f)).toBe(true);
    // Ulysses has no rating; neq on rating must NOT match it.
    expect(matchesFilter(shelf[3], filter({ op: "neq", value: 5 }))).toBe(false);
  });

  it("isSet treats explicit null as unset", () => {
    expect(matchesFilter(shelf[2], filter({ op: "isSet" }))).toBe(false);
    expect(matchesFilter(shelf[0], filter({ op: "isSet" }))).toBe(true);
    expect(matchesFilter(shelf[3], filter({ op: "notSet" }))).toBe(true);
  });

  it("compares numbers numerically and ISO dates as text", () => {
    expect(matchesFilter(shelf[0], filter({ op: "gte", value: 5 }))).toBe(true);
    expect(matchesFilter(shelf[1], filter({ op: "gte", value: 5 }))).toBe(false);
    const after = filter({
      field: "content.fields.finishedOn",
      op: "gt",
      value: "2026-05-01",
    });
    expect(matchesFilter(shelf[1], after)).toBe(true);
    expect(matchesFilter(shelf[0], after)).toBe(false);
  });

  it("contains is case-insensitive and only matches strings", () => {
    const f = filter({ field: "content.fields.status", op: "contains", value: "READ" });
    expect(matchesFilter(shelf[2], f)).toBe(true);
    expect(matchesFilter(shelf[0], filter({ op: "contains", value: "5" }))).toBe(false);
  });
});

describe("applyCollectionSpec", () => {
  it("filters then sorts, missing values last in either direction", () => {
    const spec = {
      filters: [],
      sort: [{ field: "content.fields.rating", direction: "desc" as const }],
    };
    expect(applyCollectionSpec(shelf, spec).map((b) => b.title)).toEqual([
      "Dune",
      "Blindsight",
      "Piranesi", // rating: null -> last
      "Ulysses", // rating absent -> last, stable after Piranesi
    ]);
    const ascending = {
      filters: [],
      sort: [{ field: "content.fields.rating", direction: "asc" as const }],
    };
    expect(applyCollectionSpec(shelf, ascending).map((b) => b.title)).toEqual([
      "Blindsight",
      "Dune",
      "Piranesi",
      "Ulysses",
    ]);
  });

  it("composes filters with AND and keeps the sort stable", () => {
    const spec = {
      filters: [
        { field: "content.fields.status", op: "eq" as const, value: "read" },
        { field: "content.fields.rating", op: "gte" as const, value: 4 },
      ],
      sort: [],
    } as never;
    expect(applyCollectionSpec(shelf, spec).map((b) => b.title)).toEqual([
      "Dune",
      "Blindsight",
    ]);
  });

  it("sorts by system fields alongside custom ones", () => {
    const spec = {
      filters: [],
      sort: [
        { field: "content.fields.status", direction: "asc" as const },
        { field: "title", direction: "asc" as const },
      ],
    };
    expect(applyCollectionSpec(shelf, spec).map((b) => b.title)).toEqual([
      "Ulysses", // abandoned
      "Blindsight", // read
      "Dune", // read, title tiebreak
      "Piranesi", // reading
    ]);
  });
});

describe("fieldFilterSql", () => {
  // Drizzle SQL nests fragments; flatten recursively to an inspectable string
  // with "$" placeholders where bound params go.
  const flatten = (chunk: unknown): string => {
    if (typeof chunk !== "object" || chunk === null) return "$";
    if ("queryChunks" in chunk) {
      return (chunk as { queryChunks: unknown[] }).queryChunks
        .map(flatten)
        .join("");
    }
    if ("value" in chunk && Array.isArray((chunk as { value: unknown }).value)) {
      return (chunk as { value: string[] }).value.join("");
    }
    return "$";
  };
  const render = (filters: CollectionFilter[]) => {
    const compiled = fieldFilterSql(filters);
    return compiled ? flatten(compiled) : null;
  };

  it("returns null with no filters", () => {
    expect(fieldFilterSql([])).toBeNull();
  });

  it("compiles eq to jsonb containment, the GIN-served shape", () => {
    const text = render([filter({ op: "eq", value: 5 })]);
    expect(text).toContain("@>");
    expect(text).toContain("'fields'");
  });

  it("compiles isSet to existence with a null re-check", () => {
    const text = render([filter({ op: "isSet" })]);
    expect(text).toContain("?");
    expect(text).toContain("'null'::jsonb");
  });

  it("guards numeric comparison with jsonb_typeof", () => {
    const text = render([filter({ op: "gt", value: 3 })]);
    expect(text).toContain("jsonb_typeof");
    expect(text).toContain("::numeric");
  });

  it("escapes LIKE metacharacters in contains", () => {
    const compiled = fieldFilterSql([
      filter({ field: "content.fields.status", op: "contains", value: "50%_done" }),
    ]);
    const params = JSON.stringify(compiled);
    expect(params).toContain("50\\\\%\\\\_done");
  });
});
