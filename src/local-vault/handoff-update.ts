import * as Y from "yjs";
import { applyDocumentSnapshot, documentSnapshotFromYDoc, documentText } from "@/lib/collab/document";
import { replaceSharedText } from "@/lib/collab/text-transactions";
import { stableJson } from "@/lib/documents/sync";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { externalBodyEdits, reconcileDocumentSnapshots } from "@/sync/engine/reconcile";

/** Prepare against the actual shared CRDT. The caller must durably record these
 * exact bytes before applying them; a restarted transfer must never rediff them. */
export function prepareHandoffUpdate(shared: Y.Doc, base: DocumentSnapshot, local: DocumentSnapshot): Uint8Array | null {
  const current = documentSnapshotFromYDoc(shared);
  const result = reconcileDocumentSnapshots(base, current, local, {
    concurrentInsertions: "remote-first", preserveOverlappingReplacement: true,
  });
  if (result.status !== "merged") return null;
  const comparable = (value: DocumentSnapshot) => stableJson({ ...value, content: { ...value.content, subtitle: value.content.subtitle || undefined } });
  if (comparable(result.document) === comparable(current)) return new Uint8Array([0, 0]);
  const edits = externalBodyEdits(base.content.body, current.content.body, local.content.body, result.document.content.body);
  if (!edits) return null;
  const branch = new Y.Doc();
  try {
    Y.applyUpdate(branch, Y.encodeStateAsUpdate(shared));
    const before = Y.encodeStateVector(branch);
    branch.transact(() => {
      applyDocumentSnapshot(branch, { ...result.document, content: { ...result.document.content, body: current.content.body } }, "local-handoff");
      for (const edit of edits) replaceSharedText(documentText(branch, "body"), edit.start, edit.end - edit.start, edit.replacement, "local-handoff");
    }, "local-handoff");
    return Y.encodeStateAsUpdate(branch, before);
  } finally { branch.destroy(); }
}
