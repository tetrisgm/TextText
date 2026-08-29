import { describe, expect, it } from "vitest";

import {
  authoringSourceFor,
  readAuthoringSource,
  AUTHORING_SOURCE_SCHEMA_VERSION,
} from "@/lib/presentation/authoring-source";
import {
  compileItemTypeBlueprint,
  normalizeItemTypeBlueprint,
  ITEM_TYPE_BLUEPRINT_COMPILER_VERSION,
} from "@/lib/presentation/item-type-blueprint";

/**
 * A look compiled from a blueprint used to keep only the compiled definition,
 * so the blueprint was destroyed at save and a look could never be reopened.
 * These pin the properties that make storing it safe.
 */

/** A blueprint whose layout the fields cannot support, so normalising changes it. */
const NEEDS_ADAPTING = {
  name: "Runs",
  fields: [{ id: "distance", label: "Distance", type: "number" as const }],
  collection: { layout: "calendar" as const },
};

const ALREADY_VALID = {
  name: "Notes",
  fields: [{ id: "topic", label: "Topic", type: "text" as const }],
  collection: { layout: "list" as const },
};

describe("the blueprint stored beside a look", () => {
  it("is the one that compiled, not the one that arrived", () => {
    // adaptCollectionToFields rewrites a layout the fields cannot support.
    // Storing what was sent would show a person reopening the look a layout
    // their type does not have.
    const normalized = normalizeItemTypeBlueprint(NEEDS_ADAPTING);
    expect(normalized.collection.layout).not.toBe("calendar");
  });

  it("compiles to the same definition as the blueprint it came from", () => {
    // The property the whole design rests on: reopening and recompiling must
    // not quietly produce a different look.
    for (const raw of [NEEDS_ADAPTING, ALREADY_VALID]) {
      const fromRaw = compileItemTypeBlueprint(raw, { id: "probe-type" });
      const fromNormalized = compileItemTypeBlueprint(
        normalizeItemTypeBlueprint(raw),
        { id: "probe-type" },
      );
      expect(fromNormalized).toEqual(fromRaw);
    }
  });

  it("normalising twice changes nothing further", () => {
    const once = normalizeItemTypeBlueprint(NEEDS_ADAPTING);
    expect(normalizeItemTypeBlueprint(once)).toEqual(once);
  });

  it("round trips through the stored envelope", () => {
    const blueprint = normalizeItemTypeBlueprint(ALREADY_VALID);
    const stored = JSON.parse(JSON.stringify(authoringSourceFor(blueprint)));
    expect(readAuthoringSource(stored)?.blueprint).toEqual(blueprint);
  });

  it("reads absent as absent rather than throwing", () => {
    // Built-ins, duplicates, imports, restores, looks saved from a document,
    // and every row older than the column. Ordinary answers, not failures.
    expect(readAuthoringSource(null)).toBeNull();
    expect(readAuthoringSource(undefined)).toBeNull();
    expect(readAuthoringSource({})).toBeNull();
    expect(readAuthoringSource({ kind: "something-else" })).toBeNull();
  });

  it("refuses a blueprint a later compiler can no longer honour", () => {
    // The reason the version is stored at all. Reopening it would compile the
    // same blueprint into a different look, so the honest answer is that this
    // one is edited by hand.
    const stale = {
      ...authoringSourceFor(normalizeItemTypeBlueprint(ALREADY_VALID)),
      compilerVersion: ITEM_TYPE_BLUEPRINT_COMPILER_VERSION + 1,
    };
    expect(readAuthoringSource(stale)).toBeNull();
  });

  it("stamps the current versions", () => {
    const source = authoringSourceFor(normalizeItemTypeBlueprint(ALREADY_VALID));
    expect(source.schemaVersion).toBe(AUTHORING_SOURCE_SCHEMA_VERSION);
    expect(source.compilerVersion).toBe(ITEM_TYPE_BLUEPRINT_COMPILER_VERSION);
    expect(source.kind).toBe("item-type-blueprint");
  });

  it("never becomes part of the definition that renders", () => {
    // templateDefinitionSchema is strict and definitions travel inside sync
    // envelopes and exported bundles older builds still read. Authoring
    // provenance has no business in a format that has already left this Mac.
    const definition = compileItemTypeBlueprint(ALREADY_VALID, { id: "probe-type" });
    expect(Object.keys(definition)).not.toContain("blueprint");
    expect(Object.keys(definition)).not.toContain("authoringSource");
  });
});
