"use client";

import { captureMotionOrigin } from "@/lib/motion/origin";
import { useCallback, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { setFolderLookAction } from "@/app/editor/folder-template-actions";
import { WorkspaceTypeLibrary } from "@/components/document/WorkspaceTypeLibrary";
import styles from "./FolderLookPicker.module.css";

export function FolderLookPicker({
  handle,
  folderPath,
  folderName,
  onClose: finishClose,
  onChanged,
}: {
  handle: string;
  folderPath: string;
  folderName: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [motionOrigin] = useState(captureMotionOrigin);
  const [motionOpen, setMotionOpen] = useState(true);
  const onClose = useCallback(() => setMotionOpen(false), []);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [, startTransition] = useTransition();

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
              false,
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

  return createPortal(
    <>
      <WorkspaceTypeLibrary
        handle={handle}
        folderPath={folderPath}
        targetItemCount={0}
        motionOrigin={motionOrigin}
        motionOpen={motionOpen}
        onClose={finishClose}
        onChanged={onChanged}
        onApply={(selected) => apply(selected.id, selected.version)}
      />
      {(applying || error) && (
        <div className={styles.status} role="status">
          {error ? (
            <span className={styles.error}>{error}</span>
          ) : (
            <span>Updating {folderName}</span>
          )}
        </div>
      )}
    </>,
    document.body,
  );
}
