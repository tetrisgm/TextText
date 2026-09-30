import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { readDocument } from "./model";
import type { VaultFile } from "./bridge";

export type TemplateProposal = { path: string; hash: string; templateJSON: string; templateAuthoringSourceJSON?: string | null; request?: string };

/** Presentation-only edits retain the exact Markdown and unrecognized snapshot fields. */
export function prepareTemplateProposal(file: VaultFile, proposal: TemplateProposal) {
  if (file.path !== proposal.path || file.hash !== proposal.hash) throw new Error("This file changed since the preview was proposed. Ask the assistant to read it again and refine the preview.");
  if (proposal.templateJSON.length > 1_000_000 || (proposal.templateAuthoringSourceJSON?.length ?? 0) > 1_000_000) throw new Error("This design is too large to preview.");
  const template = validateTemplateDefinition(JSON.parse(proposal.templateJSON));
  const source = validatedLookSource(template, proposal.templateAuthoringSourceJSON ? JSON.parse(proposal.templateAuthoringSourceJSON) : undefined);
  const original = readDocument(file);
  const reference = { id: template.id, version: template.version };
  const document = validateDocumentSnapshot({ ...original, presentation: { ...original.presentation, template: reference } });
  const stored = file.documentJSON ? JSON.parse(file.documentJSON) : original;
  const payload = {
    path: file.path, hash: file.hash, markdown: file.markdown,
    documentJSON: JSON.stringify({ ...stored, presentation: { ...stored.presentation, template: reference } }),
    templateJSON: JSON.stringify(template), templateAuthoringSourceJSON: source ? JSON.stringify(source) : null,
  };
  return { document, template, payload };
}
