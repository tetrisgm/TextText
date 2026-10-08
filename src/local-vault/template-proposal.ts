import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { readDocument } from "./model";
import type { VaultFile } from "./bridge";

export type TemplateProposal = { path: string; hash: string; templateJSON: string; templateAuthoringSourceJSON?: string | null; taskId?: string; request?: string };

/** Presentation-only edits retain the exact Markdown and unrecognized snapshot fields. */
export function prepareTemplateProposal(file: VaultFile, proposal: TemplateProposal) {
  if (file.path !== proposal.path || file.hash !== proposal.hash) throw new Error("This file changed since the preview was proposed. Ask the assistant to read it again and refine the preview.");
  if (proposal.templateJSON.length > 1_000_000 || (proposal.templateAuthoringSourceJSON?.length ?? 0) > 1_000_000) throw new Error("This design is too large to preview.");
  const template = validateTemplateDefinition(JSON.parse(proposal.templateJSON));
  let sourceJSON = proposal.templateAuthoringSourceJSON;
  if (sourceJSON === undefined && file.templateAuthoringSourceJSON && file.templateJSON) {
    const previous = validateTemplateDefinition(JSON.parse(file.templateJSON));
    if (previous.id === template.id) {
      // Refinement must not silently turn an authored look into an opaque spec.
      // Reuse the source only when it still compiles to the proposed definition.
      try {
        validatedLookSource(template, JSON.parse(file.templateAuthoringSourceJSON));
        sourceJSON = file.templateAuthoringSourceJSON;
      } catch {
        throw new Error("This refinement needs an updated templateAuthoringSourceJSON blueprint matching the proposed template. Read the file again and include both in the preview.");
      }
    }
  }
  const source = validatedLookSource(template, sourceJSON ? JSON.parse(sourceJSON) : undefined);
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
