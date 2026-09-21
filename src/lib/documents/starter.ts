import { emptyDocumentSnapshot } from "./model";
import type { DocumentSnapshot } from "./model";
import type { TemplateDefinition } from "@/lib/presentation/schema";

/** Used only on creation. Never apply starter values when reopening or importing. */
export function documentFromStarter(
  reference: DocumentSnapshot["presentation"]["template"],
  definition?: TemplateDefinition | null,
): DocumentSnapshot {
  const document = emptyDocumentSnapshot(reference);
  const starter = definition?.starter;
  return starter ? { ...document, content: { ...document.content,
    title: starter.title ?? "", body: starter.body ?? "", fields: { ...starter.fields },
  } } : document;
}
