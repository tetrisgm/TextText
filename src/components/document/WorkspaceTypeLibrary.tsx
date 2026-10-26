"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { emptyDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { getTypeLibraryAction, type FolderLookState } from "@/app/editor/folder-template-actions";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import styles from "./TemplateGallery.module.css";
import { TemplateGallery } from "./TemplateGallery";

type Props = Pick<ComponentProps<typeof TemplateGallery>, "onApply" | "onClose" | "motionOrigin" | "motionOpen" | "targetItemCount"> & {
  handle: string;
  folderPath?: string;
  document?: DocumentSnapshot;
};

/** Both item and folder entry points use the same authoritative library. */
export function WorkspaceTypeLibrary({ handle, folderPath, document, ...gallery }: Props) {
  const [state, setState] = useState<FolderLookState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void getTypeLibraryAction(handle, folderPath).then((next) => {
      if (!current) return;
      if (next.allowed) setState(next);
      else setError("The type library is unavailable for this workspace.");
    }).catch(() => { if (current) setError("Could not load the type library."); });
    return () => { current = false; };
  }, [handle, folderPath]);
  if (error && state) return <LibraryStatus error={error} onClose={() => setError(null)} />;
  if (!state) return <LibraryStatus error={error} onClose={gallery.onClose} />;
  return <TemplateGallery {...gallery} library={state.library}
    document={document ?? emptyDocumentSnapshot(state.current ?? { id: "texttext.note", version: 1 })}
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
