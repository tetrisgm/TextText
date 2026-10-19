import type { DocumentSnapshot } from "@/lib/documents/model";
import type { VaultFile } from "./bridge";
import type { VaultDocumentHandle } from "./document-session";

/** Close the existing durable owner before an external CAS. The caller must
 * hold runExclusive through the write and keep its input surface inert until
 * a checked reopen completes outside that lock. This does not authorize a write. */
export async function closeFileMutationOwner(
  handle: VaultDocumentHandle,
  source: VaultFile,
  document: DocumentSnapshot,
  assertCurrent: () => void,
): Promise<void> {
  const session = handle.session, client = session.client;
  const target = JSON.stringify(client.localDurabilityTarget);
  const snapshot = JSON.stringify(document);
  const check = () => {
    assertCurrent();
    if (session.client !== client || JSON.stringify(client.localDurabilityTarget) !== target ||
        session.file.path !== source.path || session.file.hash !== source.hash ||
        JSON.stringify(session.snapshot) !== snapshot || client.hasPendingChanges || client.hasUnreadableJournal) {
      throw new Error("The shared document changed. Try this file change again.");
    }
  };
  check();
  client.setActive(false);
  if (!await handle.closeExclusive(async () => {
    check();
    await client.discardCleanJournalDurably();
    check();
  })) throw new Error("Save or recover the pending edits before changing this file.");
  // localDurabilityTarget and the retained snapshot remain readable after
  // destroy. Do not read the destroyed Y.Doc, or accept a late generation.
  check();
}

/** Inert removes the focused editor from keyboard targeting. Consume only
 * plain typing/edit keys during that interval so they cannot become app
 * shortcuts. Native/system modifier shortcuts keep their normal behavior. */
export function guardFileMutationInput(surface: HTMLElement, target: Window = window): () => void {
  const key = (event: KeyboardEvent) => {
    if (!surface.inert || !surface.isConnected || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.length === 1 || ["Backspace", "Delete", "Enter"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
    }
  };
  const options = { capture: true };
  target.addEventListener("keydown", key, options);
  let removed = false;
  return () => { if (!removed) { removed = true; target.removeEventListener("keydown", key, options); } };
}
