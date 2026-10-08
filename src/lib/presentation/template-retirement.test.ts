import { describe, expect, it } from "vitest";
import { activeTemplateVersions, isTemplateRetirementPath, parseTemplateRetirement, templateRetirementSchema } from "./template-retirement";
const retirement = {
  format: "texttext-template-retirement", version: 1,
  templateId: "local.78c56737-2b69-4b8f-8db4-a0c9d6e728c3",
  sourceItemId: "78c56737-2b69-4b8f-8db4-a0c9d6e728c3", sourceVersion: 2, sourceHash: "a".repeat(64),
} as const;
describe("file-backed template retirement", () => {
  it("retires the whole identity independent of version order or later imported versions", () => {
    const versions = [1, 3, 2].map(version => ({ templateId: retirement.templateId, version }));
    const other = { templateId: "local.other", version: 1 };
    expect(activeTemplateVersions([...versions, other], [retirement])).toEqual([other]);
    expect(versions).toHaveLength(3); // Existing immutable definitions remain available to render.
  });
  it("accepts only bounded known records and never built-in retirement", () => {
    expect(parseTemplateRetirement(JSON.stringify(retirement))).toEqual(retirement);
    for (const delta of [{ version: 2 }, { templateId: "texttext.note" }, { sourceHash: "stale" }, { sourceVersion: 0 }, { sourceItemId: "../other" }, { ignored: true }]) {
      expect(() => templateRetirementSchema.parse({ ...retirement, ...delta })).toThrow();
    }
    expect(() => parseTemplateRetirement(" ".repeat(2049))).toThrow("exceeds limits");
  });
  it("fails closed instead of silently exposing retired versions when metadata is unknown", () => {
    expect(() => activeTemplateVersions([{ templateId: retirement.templateId }], [{ ...retirement, version: 2 } as never])).toThrow();
  });
});

it("recognizes only the canonical retirement directory consistently on case-sensitive hosts", () => {
  expect(isTemplateRetirementPath("Templates/Retired/id.textpack")).toBe(true);
  expect(isTemplateRetirementPath("Templates/retired/id.textpack")).toBe(false);
  expect(isTemplateRetirementPath("templates/Retired/id.textpack")).toBe(false);
});
