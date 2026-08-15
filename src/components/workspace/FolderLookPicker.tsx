"use client";

// "Make this folder look like a magazine", without talking to the assistant.
//
// The agent has had set_folder_template since the template engine landed while
// a person had no control at all, so the folder's look was the one part of the
// product you could only change by asking. Same store call, same owner check,
// same gallery a person already knows from choosing an item's look: a folder is
// not a different kind of thing to style.

import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  getFolderLookAction,
  setFolderLookAction,
  type FolderLookState,
} from "@/app/editor/folder-template-actions";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { TemplateGallery } from "@/components/document/TemplateGallery";
import styles from "./FolderLookPicker.module.css";

/**
 * The gallery previews a look by rendering a document through it. A folder has
 * no document of its own, so it previews with an empty one, which makes the
 * gallery fall back to each template's own example content. That is exactly
 * what you want here: you are judging the look, not this folder's first item.
 */
function blankDocument(): DocumentSnapshot {
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: { title: "", body: "", fields: {}, tags: [], assets: [] },
    presentation: {
      template: { id: "texttext.article", version: 1 },
      theme: {},
    },
  });
}

/**
 * Rendered into the body, never in place.
 *
 * The gallery positions itself with `position: fixed`, which resolves against
 * the viewport only while no ancestor establishes a containing block. This
 * picker is opened from the folder menu inside the sidebar, and the sidebar is
 * translucent chrome with a backdrop-filter, which is exactly one of the
 * properties that does establish one. Mounted in place, a full-screen chooser
 * rendered inside a 260px column: real cards, squeezed into a strip, with their
 * names cut to three letters. A portal makes the component correct wherever it
 * is opened from rather than correct only where it was first tried.
 */
export function FolderLookPicker({
  handle,
  folderPath,
  folderName,
  onClose,
  onChanged,
}: {
  handle: string;
  folderPath: string;
  folderName: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [state, setState] = useState<FolderLookState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getFolderLookAction(handle, folderPath);
        if (!cancelled) setState(next);
      } catch {
        if (!cancelled) {
          setState({ allowed: false, current: null, templates: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderPath, handle]);

  const apply = useCallback(
    (templateId: string, templateVersion: number) => {
      if (applying) return;
      setApplying(true);
      setError(null);
      startTransition(() => {
        void (async () => {
          try {
            const result = await setFolderLookAction(
              handle,
              folderPath,
              templateId,
              templateVersion,
              true,
            );
            if (!result.ok) {
              setError(result.error);
              return;
            }
            onChanged?.();
            onClose();
          } catch {
            setError("Could not change the folder's look.");
          } finally {
            setApplying(false);
          }
        })();
      });
    },
    [applying, folderPath, handle, onChanged, onClose],
  );

  if (!state) return null;
  if (!state.allowed || state.templates.length === 0) return null;

  // The gallery marks the applied look by comparing against the document's
  // pinned template, so the preview document carries the FOLDER's current look.
  // Named `preview`, not `document`: this file portals into the real one.
  const preview = state.current
    ? validateDocumentSnapshot({
        ...blankDocument(),
        presentation: { template: state.current, theme: {} },
      })
    : blankDocument();

  return createPortal(
    <>
      <TemplateGallery
        document={preview}
        templates={state.templates}
        onClose={onClose}
        onApply={(selected) => apply(selected.id, selected.version)}
      />
      {(applying || error) && (
        <div className={styles.status} role="status">
          {error ? (
            <span className={styles.error}>{error}</span>
          ) : (
            <span>Restyling {folderName}</span>
          )}
        </div>
      )}
    </>,
    document.body,
  );
}
