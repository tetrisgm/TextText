"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshWorkspacePool } from "@/lib/pool/store";
import {
  forgetVisualUpload,
  listPendingVisualUploads,
  rememberVisualUpload,
  type PendingVisualUpload,
} from "@/lib/visual-upload-queue";

type Entry = {
  record: PendingVisualUpload;
  url: string;
  status: "storing" | "uploading" | "failed" | "waiting";
  stored: boolean;
  error?: string;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const IMAGE_NAME = /\.(?:jpe?g|png|webp|gif|avif)$/i;

function isImage(file: File): boolean {
  return /^(?:image\/(?:jpeg|png|webp|gif|avif))$/.test(file.type) || IMAGE_NAME.test(file.name);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Could not save this image.";
}

export function VisualFolderCapture({ handle, folderPath, blogId }: {
  handle: string;
  folderPath: string;
  blogId?: string;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef(new Map<string, string>());
  const activeRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (id: string, patch: Partial<Entry>) => {
    if (mountedRef.current) setEntries((current) => current.map((entry) => entry.record.id === id ? { ...entry, ...patch } : entry));
  };

  const upload = async (record: PendingVisualUpload) => {
    if (activeRef.current.has(record.id)) return;
    activeRef.current.add(record.id);
    update(record.id, { status: "uploading", error: undefined });
    try {
      const form = new FormData();
      form.set("handle", record.handle);
      form.set("folderPath", record.folderPath);
      form.set("uploadKey", record.id);
      form.set("file", new File([record.file], record.name, { type: record.contentType }));
      const response = await fetch("/api/workspace/visual-capture", {
        method: "POST",
        headers: { "x-texttext-visual-capture": "1" },
        body: form,
      });
      const result = await response.json() as { error?: string; id?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "Could not save this image.");
      await forgetVisualUpload(record.id);
      if (mountedRef.current) setEntries((current) => current.filter((entry) => entry.record.id !== record.id));
      const url = urlsRef.current.get(record.id);
      if (url) URL.revokeObjectURL(url);
      urlsRef.current.delete(record.id);
      if (blogId) await refreshWorkspacePool(handle, blogId);
      else router.refresh();
    } catch (cause) {
      update(record.id, { status: "failed", error: message(cause) });
    } finally {
      activeRef.current.delete(record.id);
    }
  };

  const retry = async (entry: Entry) => {
    if (!entry.stored) {
      try {
        update(entry.record.id, { status: "storing", error: undefined });
        await rememberVisualUpload(entry.record);
        update(entry.record.id, { stored: true });
      } catch (cause) {
        update(entry.record.id, { status: "failed", error: message(cause) });
        return;
      }
    }
    await upload(entry.record);
  };

  const addFiles = async (files: File[]) => {
    setError(null);
    for (const file of files) {
      if (!mountedRef.current) return;
      if (!isImage(file)) { setError("Choose JPEG, PNG, WebP, GIF, or AVIF images."); continue; }
      if (file.size === 0 || file.size > MAX_FILE_BYTES) { setError("Images must be nonempty and 50 MB or smaller."); continue; }
      const record: PendingVisualUpload = {
        id: crypto.randomUUID(), handle, folderPath, name: file.name,
        contentType: file.type, file, createdAt: Date.now(),
      };
      const url = URL.createObjectURL(file);
      urlsRef.current.set(record.id, url);
      const entry: Entry = { record, url, status: "storing", stored: false };
      setEntries((current) => [entry, ...current]);
      await retry(entry);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    let live = true;
    const urls = urlsRef.current;
    void listPendingVisualUploads().then((pending) => {
      if (!live) return;
      const recovered = pending.filter((record) => record.handle === handle && record.folderPath === folderPath && !urls.has(record.id))
        .map((record): Entry => {
          const url = URL.createObjectURL(record.file);
          urls.set(record.id, url);
          return { record, url, status: "waiting", stored: true };
        });
      setEntries((current) => [...current, ...recovered.filter((entry) => !current.some((item) => item.record.id === entry.record.id))]);
    }).catch((cause) => { if (live) setError(message(cause)); });
    return () => {
      live = false;
      mountedRef.current = false;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [handle, folderPath]);

  useEffect(() => {
    const page = rootRef.current?.closest(".post-folder-page");
    if (!page) return;
    const onDragOver = (event: DragEvent) => {
      if (!(event.target instanceof Node) || !page.contains(event.target) || !event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    };
    const onDrop = (event: DragEvent) => {
      setDragging(false);
      if (!(event.target instanceof Node) || !page.contains(event.target) || !event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      void addFiles([...event.dataTransfer.files]);
    };
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (!files.length || !page.isConnected) return;
      const target = event.target;
      if (!(target instanceof Node) || (!page.contains(target) && target !== document.body)) return;
      event.preventDefault();
      void addFiles(files);
    };
    const onDragEnd = () => setDragging(false);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragend", onDragEnd);
    };
  });

  return <div ref={rootRef} className={`visual-folder-capture${dragging ? " is-drop-target" : ""}`}>
    <button type="button" className="visual-folder-add" onClick={() => inputRef.current?.click()}>Add images</button>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden
      onChange={(event) => { void addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
    {dragging && <p className="visual-folder-drop-hint">Drop images in this folder</p>}
    {error && <p className="visual-folder-error" role="alert">{error}</p>}
    {entries.length > 0 && <div className="visual-folder-pending" aria-label="Images waiting to save">
      {entries.map((entry) => <div key={entry.record.id} className="visual-folder-pending-item">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={entry.url} alt="" />
        <div><strong>{entry.record.name}</strong><span role="status">{entry.status === "storing" ? "Saving on this device…" : entry.status === "uploading" ? "Uploading…" : entry.error ?? "Ready to retry"}</span></div>
        {(entry.status === "failed" || entry.status === "waiting") && <button type="button" onClick={() => void retry(entry)}>Retry</button>}
      </div>)}
    </div>}
  </div>;
}
