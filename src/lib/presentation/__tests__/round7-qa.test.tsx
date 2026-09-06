import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compileItemTypeBlueprint } from "../item-type-blueprint";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { DocumentRenderer, DocumentCollectionRenderer } from "@/components/document/DocumentRenderer";
import { queryCollectionItems } from "../collection-layout";
import { isSafeLinkHref } from "@/lib/content";

const rating = { name: "Reading list", fields: [{ id: "rating", label: "Rating", type: "number", format: "rating", validation: { min: 0, max: 1e20 } }], collection: { layout: "list", summaryFields: ["rating"] } };

describe("round 7 QA regressions", () => {
  it.each([["reader", DocumentRenderer], ["collection", DocumentCollectionRenderer]] as const)("P1: validated rating cannot crash %s", (_name, Renderer) => {
    const template = compileItemTypeBlueprint(rating, { id: "reading" });
    const document = validateDocumentSnapshot({ schemaVersion: 1, content: { title: "Book", fields: { rating: 4 } }, presentation: { template: { id: template.id, version: 1 } } });
    expect(() => renderToStaticMarkup(<Renderer template={template} document={document} />)).not.toThrow();
  });
  it.each(["eq", "gte"])("P2: reject a string operand for a numeric %s filter before silently excluding every book", (op) => {
    expect(() => compileItemTypeBlueprint({ ...rating, fields: [{ id: "rating", label: "Rating", type: "number" }], collection: { layout: "list", filters: [{ field: "rating", op, value: "4" }] } }, { id: "reading" })).toThrow(/number|numeric/i);
  });
  it("P3: default chronological ordering accepts Date metadata", () => {
    const old = { title: "Old", fields: {}, updatedAt: new Date("2026-09-02T12:00:00Z") };
    const recent = { title: "Recent", fields: {}, updatedAt: new Date("2026-09-03T12:00:00Z") };
    expect(queryCollectionItems([old, recent], null).map(item => item.title)).toEqual(["Recent", "Old"]);
  });
  it.each(["java\nscript:alert(1)", "java\tscript:alert(1)"])("P2: URL allowlist rejects browser-normalized script schemes %j", (href) => {
    expect(new URL(href).protocol).toBe("javascript:");
    expect(isSafeLinkHref(href)).toBe(false);
  });
});

import { readFileSync } from "node:fs";
const css = readFileSync("src/styles/apple.css", "utf8");
const studioCss = readFileSync("src/components/workspace/ItemTypeStudio.module.css", "utf8");
function rgb(value: string): number[] {
  if (value.startsWith("#")) return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  return value.match(/[\d.]+/g)!.map(Number);
}
function luminance(c: number[]) {
  return c.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
it.each(["light", "dark"])("P2: %s studio small explanatory text and errors meet 4.5:1", theme => {
  const block = theme === "light" ? css.slice(0, css.indexOf('[data-theme="dark"] .applecms')) : css.split('[data-theme="dark"] .applecms')[1].split("}")[0];
  const token = (name: string) => rgb(block.match(new RegExp(`--ac-${name}:\\s*([^;]+);`))![1]);
  const bg = token("bg");
  expect(studioCss).toContain("color: var(--ac-label-3)");
  expect(studioCss).toContain("color: var(--ac-red)");
  for (const name of ["label-3", "red"]) {
    const fg = token(name);
    const painted = fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
    const a = luminance(painted), b = luminance(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect.soft(ratio, `${theme} ${name} contrast ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  }
});
