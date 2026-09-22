"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { emptyDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import {
  getTypeLibraryAction, duplicateFolderLookAction, importFolderLookAction,
  restoreFolderLookVersionAction, retireFolderLookAction, exportTemplateLookAction,
  type FolderLookState,
} from "@/app/editor/folder-template-actions";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import styles from "./TemplateGallery.module.css";
import { TemplateGallery } from "./TemplateGallery";

type Props = Pick<ComponentProps<typeof TemplateGallery>, "onApply" | "onClose" | "motionOrigin" | "motionOpen" | "targetItemCount"> & {
  handle: string;
  folderPath?: string;
  document?: DocumentSnapshot;
  onChanged?: () => void;
};

/** Both item and folder entry points use the same authoritative library. */
export function WorkspaceTypeLibrary({ handle, folderPath, document, onChanged, ...gallery }: Props) {
  const [state, setState] = useState<FolderLookState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const next = await getTypeLibraryAction(handle, folderPath);
    if (!next.allowed) throw new Error("The type library is unavailable for this workspace.");
    setState(next);
    return next;
  }, [handle, folderPath]);
  useEffect(() => {
    let current = true;
    void getTypeLibraryAction(handle, folderPath).then((next) => {
      if (!current) return;
      if (next.allowed) setState(next);
      else setError("The type library is unavailable for this workspace.");
    }).catch(() => { if (current) setError("Could not load the type library."); });
    return () => { current = false; };
  }, [handle, folderPath]);
  if (!state) return <LibraryStatus error={error} onClose={gallery.onClose} />;
  const changed = async () => { await load(); onChanged?.(); };
  return <TemplateGallery {...gallery} library={state.library}
    document={document ?? emptyDocumentSnapshot(state.current ?? { id: "texttext.note", version: 1 })}
    onExport={(selected) => exportTemplateLookAction(handle, selected.id, selected.version)}
    onDuplicate={async (selected, name) => {
      const result = await duplicateFolderLookAction(handle, selected.id, selected.version, name);
      if (!result.ok) throw new Error(result.error);
      await changed(); return result.definition;
    }}
    onImport={async (text, mode) => {
      const result = await importFolderLookAction(handle, text, mode);
      if (!result.ok) throw new Error(result.error);
      await changed(); return result.definition;
    }}
    onRestoreVersion={async (selected) => {
      const result = await restoreFolderLookVersionAction(handle, selected.id, selected.version);
      if (!result.ok) throw new Error(result.error);
      await changed(); return result.definition;
    }}
    onRetire={async (selected) => {
      const result = await retireFolderLookAction(handle, selected.id);
      if (!result.ok) throw new Error(result.error);
      await changed();
    }}
  />;
}

function LibraryStatus({ error, onClose }: { error: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true);
  return <div ref={ref} className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Type library"
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <section className={styles.importPanel}>
      <p role={error ? "alert" : "status"}>{error ?? "Loading types…"}</p>
      <button type="button" onClick={onClose}>Close</button>
    </section>
  </div>;
}
