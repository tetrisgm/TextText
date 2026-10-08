import { createHash } from "node:crypto";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { requireBuiltinTemplate } from "./templates";
import { templateRetirementSchema, type TemplateRetirement } from "./template-retirement";

export function templateRetirementIdentity(operationId: string) {
  const hex = createHash("sha256").update(`texttext-template-retirement-v1:${operationId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function buildTemplateRetirement(record: TemplateRetirement, name: string, operationId: string) {
  const retirement = templateRetirementSchema.parse(record);
  const itemId = templateRetirementIdentity(operationId);
  const template = requireBuiltinTemplate("texttext.note");
  const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
  document.content.title = `Retired template: ${name}`;
  document.content.body = JSON.stringify(retirement, null, 2);
  document.content.fields.texttextRecordType = "template-retirement";
  return { itemId, relativePath: `Templates/Retired/${itemId}.textpack`, bytes: buildTextpack("Retirement", {
    document, template, markdown: `---\ntextTextId: ${itemId}\ntitle: ${JSON.stringify(document.content.title)}\n---\n\n${document.content.body}`,
  }) };
}
