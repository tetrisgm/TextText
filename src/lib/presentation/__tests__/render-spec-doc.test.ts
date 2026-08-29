import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  collectionRenderSchema,
  documentFieldDefinitionSchema,
  renderNodeSchema,
  templateDefinitionSchema,
  themeTokensSchema,
} from "@/lib/presentation/schema";

/**
 * docs/render-spec.md is the only readable description of the template
 * language. It is handed to people and, from the item-type prompt, to the
 * model. A reference that quietly falls behind the schema is worse than none:
 * it teaches a vocabulary that no longer validates.
 *
 * So the vocabulary is read out of the Zod schemas at runtime rather than
 * retyped here, and checked both ways. A primitive added to the schema fails
 * this test until it is documented, and a primitive removed from the schema
 * fails it until the page stops claiming it.
 */

const DOC = readFileSync("docs/render-spec.md", "utf8");

type Def = Record<string, unknown>;

/** Zod stores a discriminator's value under one of three keys by kind. */
function discriminatorValues(shapeType: unknown): string[] {
  const def = (shapeType as { _def?: Def } | undefined)?._def as
    | { value?: string; values?: string[]; entries?: Record<string, string> }
    | undefined;
  if (def?.value !== undefined) return [String(def.value)];
  if (def?.values) return def.values;
  if (def?.entries) return Object.values(def.entries);
  return [];
}

function unionOptions(schema: unknown): Array<{ shape: Record<string, unknown> }> {
  const node = schema as { _def?: Def; options?: unknown[] };
  const def = (node._def ?? {}) as {
    getter?: () => unknown;
    options?: unknown[];
    out?: unknown;
  };
  // renderNodeSchema is wrapped in z.preprocess so legacy node spellings
  // normalise on parse. That makes it a pipe, whose `out` holds the real
  // union. Unwrap it, or this reads zero types and every check below passes
  // vacuously, which is exactly what the guard above caught.
  if (def.out) return unionOptions(def.out);
  if (def.getter) return unionOptions(def.getter());
  return (node.options ?? def.options ?? []) as Array<{ shape: Record<string, unknown> }>;
}

function enumValues(schema: unknown): string[] {
  let current = schema as Def | undefined;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const def = (current._def ?? {}) as Def;
    if (def.entries) return Object.values(def.entries as Record<string, string>);
    if (def.values) return def.values as string[];
    current = (def.innerType ?? def.type ?? def.schema) as Def | undefined;
  }
  return [];
}

/** A word is documented if it appears as a whole token on the page. */
function documents(word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(DOC);
}

/**
 * The render-node half of the page only.
 *
 * Searching the whole document let a node name pass on an unrelated mention:
 * `media` matched the THEME axis of the same name, so the node could have gone
 * undocumented and the test would still have been green.
 */
const NODE_SECTION = DOC.slice(
  DOC.indexOf("## Render nodes"),
  DOC.indexOf("## Collections"),
);

/**
 * A node counts as documented only when it has its own TABLE ROW in that
 * section. Accepting a mention anywhere was still too loose: prose explaining
 * that `cover` normalises to `media` was enough to satisfy the check for
 * `media`, so the node could have been dropped from the table unnoticed.
 */
function documentsNode(word: string): boolean {
  const row = new RegExp(
    `^\\| \`${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\` \\|`,
    "m",
  );
  return row.test(NODE_SECTION);
}

describe("docs/render-spec.md matches the schema", () => {
  const nodeTypes = unionOptions(renderNodeSchema)
    .flatMap((option) => discriminatorValues(option.shape.type))
    .sort();

  const fieldTypes = unionOptions(documentFieldDefinitionSchema)
    .flatMap((option) => discriminatorValues(option.shape.type))
    .sort();

  it("reads a real vocabulary out of the schema", () => {
    // Guards the introspection itself: if a Zod upgrade moves these keys the
    // lists go empty and every check below would pass vacuously.
    expect(nodeTypes.length).toBeGreaterThan(15);
    expect(fieldTypes.length).toBeGreaterThan(8);
  });

  it.each(nodeTypes)("documents the %s node", (type) => {
    expect(documentsNode(type)).toBe(true);
  });

  it.each(fieldTypes)("documents the %s field type", (type) => {
    expect(documents(type)).toBe(true);
  });

  const collectionShape = (collectionRenderSchema as unknown as { shape: Record<string, unknown> })
    .shape;

  it.each(enumValues(collectionShape.layout))("documents the %s collection layout", (layout) => {
    expect(documents(layout)).toBe(true);
  });

  it.each(Object.keys(collectionShape))("documents the collection key %s", (key) => {
    expect(documents(key)).toBe(true);
  });

  const themeShape = (themeTokensSchema as unknown as { shape: Record<string, unknown> }).shape;

  it.each(Object.keys(themeShape))("documents the %s theme axis", (axis) => {
    expect(documents(axis)).toBe(true);
  });

  it.each(Object.keys(themeShape).flatMap((axis) => enumValues(themeShape[axis])))(
    "documents the theme value %s",
    (value) => {
      expect(documents(value)).toBe(true);
    },
  );

  it.each(
    Object.keys(
      (templateDefinitionSchema as unknown as { shape: Record<string, unknown> }).shape,
    ),
  )("documents the template key %s", (key) => {
    expect(documents(key)).toBe(true);
  });

  it("claims no node type the schema does not have", () => {
    // The other direction: a type named in the node tables must still exist.
    const tableRows = DOC.split("\n").filter((line) => /^\| `[a-z]+` \|/.test(line));
    const claimed = tableRows
      .map((line) => line.match(/^\| `([a-z]+)` \|/)?.[1])
      .filter((name): name is string => Boolean(name));
    const known = new Set([
      ...nodeTypes,
      ...fieldTypes,
      ...Object.keys(collectionShape),
      ...Object.keys(themeShape),
      ...Object.keys(
        (templateDefinitionSchema as unknown as { shape: Record<string, unknown> }).shape,
      ),
    ]);
    const unknown = [...new Set(claimed)].filter((name) => !known.has(name));
    expect(unknown).toEqual([]);
  });
});
