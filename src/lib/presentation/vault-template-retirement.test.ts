import { expect, it } from "vitest";
import { openPack } from "@/local-vault/pack";
import { readDocument } from "@/local-vault/model";
import { buildTemplateRetirement } from "./vault-template-retirement";
import { isTemplateRetirementPath, parseTemplateRetirement } from "./template-retirement";
it("stores a validated identity retirement in an ordinary agent-editable TextPack", () => {
  const record = { format: "texttext-template-retirement", version: 1, templateId: "local.custom", sourceItemId: "78c56737-2b69-4b8f-8db4-a0c9d6e728c3", sourceVersion: 2, sourceHash: "a".repeat(64) } as const;
  const pack = buildTemplateRetirement(record, "Research", "operation");
  const document = readDocument(openPack(pack.bytes, pack.relativePath, "", pack.itemId).file);
  expect(isTemplateRetirementPath(pack.relativePath)).toBe(true);
  expect(document.content.fields.texttextRecordType).toBe("template-retirement");
  expect(parseTemplateRetirement(document.content.body)).toEqual(record);
  expect(buildTemplateRetirement(record, "Research", "operation").itemId).toBe(pack.itemId);
  expect(buildTemplateRetirement(record, "Research", "new-operation").itemId).not.toBe(pack.itemId);
});
