"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { captureIntent } from "@/lib/capture-intent";
import {
  enqueueCapture,
  readCaptureQueue,
  recoverCaptureQueue,
  removeCapture,
  updateCapture,
  writeCaptureQueue,
} from "@/lib/capture-queue";
import type { CaptureQueueEntry } from "@/lib/capture-queue";
import type { Blog, Folder, Post } from "@/lib/content";
import type { TemplateReference } from "@/lib/documents/model";
import { parseItemInput } from "@/lib/item-creation";
import {
  blogPostEditPath,
  blogWorkspacePostEditPath,
  blogWorkspacePostPath,
} from "@/lib/public-paths";

export type FolderCreateRequest =
  | {
      type: "article";
      folderPath: string;
      template?: TemplateReference;
      title?: string;
      body?: string;
    }
  | {
      type: "note";
      folderPath: string;
      template?: TemplateReference;
      title?: string;
      body?: string;
    }
  | {
      type: "bookmark";
      folderPath: string;
      blank: true;
      template?: TemplateReference;
      title?: string;
      body?: string;
    }
  | {
      type: "bookmark";
      folderPath: string;
      blank?: false;
      description?: string;
      template?: TemplateReference;
      url: string;
      title?: string;
    };

type FolderCreateOptions = {
  /** Home captures stay in the inbox. Folder creation keeps opening the item. */
  open?: boolean;
  /** Raw inbox input. The shell sends this through the shared create_item command. */
  capture?: string;
  /** Stable across ambiguous retries so one capture can never create twice. */
  idempotencyKey?: string;
  /** Called only after the server has returned the durable item and receipt. */
  onPersisted?: (post: Post, receipt?: FolderCaptureReceipt) => void;
  /** Called after a bounded in-place capture fails and its optimistic row is removed. */
  onFailed?: (error: unknown) => void;
};

type FolderCaptureReceipt = {
  itemId: string;
  savedTo: string;
  title: string;
};

export type FolderCreateItem = (
  request: FolderCreateRequest,
  options?: FolderCreateOptions,
) => Post | void;

export type FolderDeleteItem = (post: Post) => Promise<void> | void;
export type FolderCaptureResolved = (post: Post) => void;

type InboxCapture = CaptureQueueEntry<FolderCreateRequest, Post>;

export const CREATE_FOLDER_ITEM_EVENT = "texttext:create-folder-item";
export const EDIT_FOLDER_TITLE_EVENT = "texttext:edit-folder-title";
type FolderUiEventDetail = { folderId: string };

export function dispatchFolderUiEvent(type: string, folderId: string) {
  window.dispatchEvent(
    new CustomEvent<FolderUiEventDetail>(type, { detail: { folderId } }),
  );
}
export function isFolderUiEvent(event: Event, folderId: string): boolean {
  return (
    (event as CustomEvent<FolderUiEventDetail>).detail?.folderId === folderId
  );
}
export function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function defaultTemplateForFolder(folder: Folder): TemplateReference {
  if (folder.defaultTemplate) return folder.defaultTemplate;
  return {
    id:
      folder.mode === "notes"
        ? "texttext.note"
        : folder.mode === "bookmarks"
          ? "texttext.bookmark"
          : "texttext.article",
    version: 1,
  };
}

// Creating is one action, not a form. There is nothing to decide before you
// type: the current folder is the destination. Every client capture keeps its
// raw input and retry key locally until a server receipt. Home stays in place;
// a folder opens the saved item.
export function UniversalItemComposer({
  blog,
  destinations,
  focusRequestKey = 0,
  folder,
  handle,
  onCreateItem,
  onDeleteItem,
  onOpenCapturedItem,
}: {
  blog: Blog;
  destinations?: readonly Folder[];
  focusRequestKey?: number;
  folder: Folder;
  handle: string;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onOpenCapturedItem?: (post: Post) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusRequestKey = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [captures, setCaptures] = useState<InboxCapture[]>([]);
  const failedCaptures = useMemo(
    () => captures.filter((capture) => capture.status === "failed"),
    [captures],
  );
  const [hydratedCaptureQueueHandle, setHydratedCaptureQueueHandle] = useState<
    string | null
  >(null);
  const capturesRef = useRef<InboxCapture[]>([]);
  const capturesInPlace = Boolean(destinations?.length);
  const captureQueueReady = hydratedCaptureQueueHandle === handle;

  useEffect(() => () => {
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
  }, []);

  const showSaveStatus = useCallback((message: string) => {
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
    setSaveStatus(message);
    saveStatusTimer.current = setTimeout(() => setSaveStatus(null), 5000);
  }, []);

  useEffect(() => {
    if (focusRequestKey <= lastFocusRequestKey.current) return;
    lastFocusRequestKey.current = focusRequestKey;
    inputRef.current?.focus();
  }, [focusRequestKey]);

  const replaceCaptures = useCallback(
    (next: readonly InboxCapture[], required = false): boolean => {
      try {
        const persisted = writeCaptureQueue(
          window.localStorage,
          handle,
          next,
        );
        capturesRef.current = persisted;
        setCaptures(persisted);
        return true;
      } catch (storageError) {
        if (!required) {
          capturesRef.current = [...next];
          setCaptures([...next]);
        }
        setError(
          actionErrorMessage(
            storageError,
            "Device storage is unavailable. Keep this page open and copy your text before leaving.",
          ),
        );
        return false;
      }
    },
    [handle],
  );

  const patchCapture = useCallback(
    (id: string, patch: Partial<InboxCapture>) =>
      replaceCaptures(updateCapture(capturesRef.current, id, patch)),
    [replaceCaptures],
  );

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      const recovered = recoverCaptureQueue(
        readCaptureQueue<FolderCreateRequest, Post>(window.localStorage, handle),
      );
      if (replaceCaptures(recovered)) setHydratedCaptureQueueHandle(handle);
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, [handle, replaceCaptures]);

  const destinationFor = useCallback(
    (): Folder => folder,
    [folder],
  );

  const runInPlaceCapture = useCallback(
    (capture: InboxCapture) => {
      showSaveStatus(capture.request.type === "bookmark" ? "Saving link…" : "Saving note…");
      patchCapture(capture.id, {
        error: undefined,
        post: undefined,
        status: "saving",
      });
      if (!onCreateItem) {
        void fetch("/api/workspace/folder-capture", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-TextText-Capture": "1",
          },
          body: JSON.stringify({
            handle,
            folderPath: capture.request.folderPath,
            capture: capture.raw,
            idempotencyKey: capture.idempotencyKey,
          }),
        }).then(async (response) => {
          const payload = await response.json().catch(() => null) as {
            error?: string;
            item?: { id: string; slug: string };
            receipt?: { itemId: string; savedTo: string; title: string };
          } | null;
          if (!response.ok) throw new Error(payload?.error ?? "The capture could not be saved.");
          const item = payload?.item;
          const receipt = payload?.receipt;
          if (!item?.id || !item.slug || receipt?.itemId !== item.id ||
            receipt.savedTo !== capture.request.folderPath) {
            throw new Error("The capture receipt did not match the saved item.");
          }
          return { item, receipt };
        }).then(({ item, receipt }) => {
          patchCapture(capture.id, {
            destination: capture.destination,
            error: undefined,
            status: "saved",
            title: receipt.title,
          });
          showSaveStatus(capture.request.type === "bookmark" ? "Link saved. Capturing readable content…" : "Note saved.");
          const destination = capture.request.type === "bookmark"
            ? blogWorkspacePostPath(blog, capture.request.folderPath, item)
            : blogWorkspacePostEditPath(blog, capture.request.folderPath, item);
          router.push(destination);
        }).catch((captureError) => {
          setSaveStatus(null);
          patchCapture(capture.id, {
            error: actionErrorMessage(captureError, "This item could not be saved. Your unsaved text is available below."),
            status: "failed",
          });
        });
        return;
      }
      try {
        const created = onCreateItem(capture.request, {
          capture: capture.raw,
          idempotencyKey: capture.idempotencyKey,
          open: !capturesInPlace,
          onPersisted: (savedPost, receipt) => {
            if (!receipt || receipt.itemId !== savedPost.id) {
              patchCapture(capture.id, {
                error:
                  "The save could not be confirmed. Retry to check whether this item was saved.",
                post: undefined,
                status: "failed",
              });
              return;
            }
            patchCapture(capture.id, {
              destination: receipt.savedTo,
              error: undefined,
              post: savedPost,
              status: "saved",
              title: receipt.title,
            });
            showSaveStatus(capture.request.type === "bookmark" ? "Link saved. Capturing readable content…" : "Note saved.");
          },
          onFailed: (captureError) => {
            setSaveStatus(null);
            patchCapture(capture.id, {
              error: actionErrorMessage(
                captureError,
                "TextText could not save this yet",
              ),
              post: undefined,
              status: "failed",
            });
          },
        });
        if (!created) {
          setSaveStatus(null);
          patchCapture(capture.id, {
            error: "This item could not be saved. Your unsaved text is available below.",
            post: undefined,
            status: "failed",
          });
          return;
        }
        patchCapture(capture.id, { post: created });
      } catch (captureError) {
        setSaveStatus(null);
        patchCapture(capture.id, {
          error: actionErrorMessage(
            captureError,
            "This item could not be saved. Your unsaved text is available below.",
          ),
          post: undefined,
          status: "failed",
        });
      }
      window.requestAnimationFrame(() => inputRef.current?.focus());
    },
    [blog, capturesInPlace, handle, onCreateItem, patchCapture, router, showSaveStatus],
  );

  const queueInPlaceCapture = useCallback(
    (
      request: FolderCreateRequest,
      destination: Folder,
      title: string,
      raw: string,
    ): boolean => {
      const capture: InboxCapture = {
        createdAt: Date.now(),
        destination: destination.name,
        id: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        raw,
        request,
        status: "saving",
        title,
      };
      const queued = enqueueCapture(capturesRef.current, capture);
      if (!queued.some((entry) => entry.id === capture.id)) {
        setError(
          "Six unsaved items need attention. Retry or discard one before saving another.",
        );
        return false;
      }
      // This is the loss boundary: raw input and its stable retry key reach
      // durable browser storage before the textarea is ever cleared.
      if (!replaceCaptures(queued, true)) return false;
      runInPlaceCapture(capture);
      return true;
    },
    [replaceCaptures, runInPlaceCapture],
  );

  const undoCapture = useCallback(
    async (capture: InboxCapture) => {
      if (!onDeleteItem || !capture.post) return;
      patchCapture(capture.id, {
        error: undefined,
        status: "deleting",
      });
      try {
        // The receipt is only dismissed after the server has confirmed Trash.
        await onDeleteItem(capture.post);
        replaceCaptures(removeCapture(capturesRef.current, capture.id));
        window.requestAnimationFrame(() => inputRef.current?.focus());
      } catch (deleteError) {
        patchCapture(capture.id, {
          error: actionErrorMessage(deleteError, "Could not undo the save. The item may still be in your workspace."),
          status: "saved",
        });
      }
    },
    [onDeleteItem, patchCapture, replaceCaptures],
  );

  const copyCaptureRaw = useCallback(async (capture: InboxCapture) => {
    try {
      await navigator.clipboard.writeText(capture.raw);
      setError(null);
    } catch (copyError) {
      setError(actionErrorMessage(copyError, "Could not copy your text. Open View text and copy it manually."));
    }
  }, []);

  const discardCapture = useCallback(
    (capture: InboxCapture) => {
      if (
        !window.confirm(
          `Discard the unsaved item “${capture.title}”? This cannot be undone.`,
        )
      ) {
        return;
      }
      replaceCaptures(removeCapture(capturesRef.current, capture.id));
      window.requestAnimationFrame(() => inputRef.current?.focus());
    },
    [replaceCaptures],
  );

  useEffect(() => {
    const createRequested = (event: Event) => {
      if (!isFolderUiEvent(event, folder.id)) return;
      inputRef.current?.focus();
    };
    window.addEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
    return () =>
      window.removeEventListener(CREATE_FOLDER_ITEM_EVENT, createRequested);
  }, [folder.id]);

  const createItem = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const value = String(data.get("item") ?? "").trim();
      if (!value) {
        inputRef.current?.focus();
        return;
      }
      if (!captureQueueReady) {
        setError("Restoring unsaved items. Your text is still here. Try saving again in a moment.");
        inputRef.current?.focus();
        return;
      }

      const draft = parseItemInput(value);
      const capturePreview = captureIntent(value);
      const destination = destinationFor();
      const template = draft.sourceUrl
        ? { id: "texttext.bookmark", version: 1 }
        : destination.defaultTemplate?.id === "texttext.bookmark" ||
            destination.defaultTemplate?.id === "texttext.article"
          ? { id: "texttext.note", version: 1 }
          : defaultTemplateForFolder(destination);
      const type = draft.sourceUrl ? "bookmark" : "note";
      const request: FolderCreateRequest =
        type === "bookmark"
          ? draft.sourceUrl
            ? {
                type,
                folderPath: destination.path,
                template,
                url: draft.sourceUrl,
                description: draft.body || undefined,
              }
            : {
                type,
                blank: true,
                body: draft.body,
                folderPath: destination.path,
                template,
                title: draft.title,
              }
          : {
              type,
              body: draft.body,
              folderPath: destination.path,
              template,
              title: draft.title,
            };

      setError(null);
      if (queueInPlaceCapture(
        request,
        destination,
        capturePreview.title || draft.title || "Untitled",
        value,
      )) form.reset();
    },
    [
      captureQueueReady,
      destinationFor,
      queueInPlaceCapture,
    ],
  );

  return (
    <>
      <form className="universal-item-composer" onSubmit={createItem}>
        <textarea
          ref={inputRef}
          name="item"
          className="universal-item-composer-input"
          placeholder="Write a note or paste a link…"
          aria-label={capturesInPlace ? "Save to TextText" : "Create an item"}
          autoCapitalize="sentences"
          autoCorrect="on"
          rows={1}
          onKeyDown={(event) => {
            // Home is an inbox: Enter saves without taking the person away.
            // A folder already supplies intent, so its composer still creates
            // and opens the item. Shift+Enter is always the newline.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          className="ac-icon-btn universal-item-create"
          aria-label={capturesInPlace ? "Save to TextText" : "Create item"}
          disabled={!captureQueueReady}
        >
          <span aria-hidden="true">↑</span>
        </button>
      </form>
      {saveStatus ? <p className="universal-item-save-status" role="status">{saveStatus}</p> : null}
      {/* Failed saves retain their full retry receipt. */}
      {failedCaptures.length > 0 && (
        <div className="universal-item-receipts" aria-label="Unsaved items">
          {failedCaptures.map((capture) => (
            <div
              className={`universal-item-receipt is-${capture.status}`}
              role="status"
              key={capture.id}
            >
              <span className="universal-item-receipt-copy">
                <strong>{capture.title}</strong>
                <small>
                  {capture.status === "saving"
                    ? `Saving to ${capture.destination}`
                    : capture.status === "deleting"
                      ? "Undoing save"
                      : capture.error
                        ? capture.error
                        : capture.status === "saved"
                          ? `Saved to ${capture.destination}`
                          : "Ready to retry"}
                </small>
              </span>
              <span className="universal-item-receipt-actions">
                {capture.status === "saved" && capture.post && (
                  <button
                    type="button"
                    className="ac-btn ac-btn-plain"
                    aria-label={`Open ${capture.title}`}
                    onClick={() => {
                      if (onOpenCapturedItem) {
                        onOpenCapturedItem(capture.post!);
                      } else {
                        router.push(blogPostEditPath(blog, capture.post!));
                      }
                    }}
                  >
                    Open
                  </button>
                )}
                {capture.status === "failed" && (
                  <>
                    <button
                      type="button"
                      className="ac-btn ac-btn-plain"
                      aria-label={`Retry saving ${capture.title}`}
                      onClick={() => runInPlaceCapture(capture)}
                    >
                      Retry saving
                    </button>
                    <details className="universal-item-receipt-raw">
                      <summary
                        className="ac-btn ac-btn-plain"
                        aria-label={`View unsaved text for ${capture.title}`}
                      >
                        View text
                      </summary>
                      <pre>{capture.raw}</pre>
                    </details>
                    <button
                      type="button"
                      className="ac-btn ac-btn-plain"
                      aria-label={`Copy unsaved text for ${capture.title}`}
                      onClick={() => void copyCaptureRaw(capture)}
                    >
                      Copy text
                    </button>
                    <button
                      type="button"
                      className="ac-btn ac-btn-plain"
                      aria-label={`Discard unsaved item ${capture.title}`}
                      onClick={() => discardCapture(capture)}
                    >
                      Discard
                    </button>
                  </>
                )}
                {capture.status === "saved" &&
                  capture.post &&
                  onDeleteItem && (
                    <button
                      type="button"
                      className="ac-btn ac-btn-plain"
                      aria-label={`Undo saving ${capture.title}`}
                      onClick={() => void undoCapture(capture)}
                    >
                      Undo
                    </button>
                  )}
              </span>
            </div>
          ))}
        </div>
      )}
      {error && (
        <span className="post-folder-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
