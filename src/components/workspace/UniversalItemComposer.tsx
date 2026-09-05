"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  createFolderItemAction,
  createWorkspacePostAction,
} from "@/app/editor/actions";
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
import { blogPostEditPath } from "@/lib/public-paths";

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

function compatibilityTypeForTemplate(
  template: TemplateReference,
  sourceUrl: string | null,
): "article" | "note" | "bookmark" {
  if (sourceUrl || template.id === "texttext.bookmark") return "bookmark";
  if (template.id === "texttext.note") return "note";
  return "article";
}

// One empty state shape: a plain sentence and, when the reader may write

// Creating is one action, not a form. There is nothing to decide before you
// type: the destination and the look follow from where you are and from what
// you typed, and both stay changeable afterwards. `destinations` is the set of
// root collections the workspace home may route into; a folder page passes
// none, because a folder page already knows where the item goes.
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
  const lastFocusRequestKey = useRef(focusRequestKey);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captures, setCaptures] = useState<InboxCapture[]>([]);
  const failedCaptures = useMemo(
    () => captures.filter((capture) => capture.status === "failed"),
    [captures],
  );
  const [hydratedCaptureQueueHandle, setHydratedCaptureQueueHandle] = useState<
    string | null
  >(
    destinations?.length ? null : handle,
  );
  const capturesRef = useRef<InboxCapture[]>([]);
  const [, startTransition] = useTransition();
  const capturesInPlace = Boolean(destinations?.length);
  const captureQueueReady =
    !capturesInPlace || hydratedCaptureQueueHandle === handle;

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
            "TextText could not protect this capture locally",
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
    if (!capturesInPlace) return;
    const hydrate = window.setTimeout(() => {
      const recovered = recoverCaptureQueue(
        readCaptureQueue<FolderCreateRequest, Post>(window.localStorage, handle),
      );
      if (replaceCaptures(recovered)) setHydratedCaptureQueueHandle(handle);
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, [capturesInPlace, handle, replaceCaptures]);

  // A pasted link belongs with the other saved links, wherever you typed it.
  const destinationFor = useCallback(
    (sourceUrl: string | null): Folder => {
      if (!destinations?.length) return folder;
      return (
        destinations.find(
          (candidate) => candidate.mode === (sourceUrl ? "bookmarks" : "notes"),
        ) ?? folder
      );
    },
    [destinations, folder],
  );

  const runInPlaceCapture = useCallback(
    (capture: InboxCapture) => {
      if (!onCreateItem) return;
      patchCapture(capture.id, {
        error: undefined,
        post: undefined,
        status: "saving",
      });
      try {
        const created = onCreateItem(capture.request, {
          capture: capture.raw,
          idempotencyKey: capture.idempotencyKey,
          open: false,
          onPersisted: (savedPost, receipt) => {
            if (!receipt || receipt.itemId !== savedPost.id) {
              patchCapture(capture.id, {
                error:
                  "The item was saved without an exact receipt. Retry to confirm it.",
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
          },
          onFailed: (captureError) => {
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
          patchCapture(capture.id, {
            error: "TextText could not start this capture.",
            post: undefined,
            status: "failed",
          });
          return;
        }
        patchCapture(capture.id, { post: created });
      } catch (captureError) {
        patchCapture(capture.id, {
          error: actionErrorMessage(
            captureError,
            "TextText could not start this capture",
          ),
          post: undefined,
          status: "failed",
        });
      }
      window.requestAnimationFrame(() => inputRef.current?.focus());
    },
    [onCreateItem, patchCapture],
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
          "Six captures still need attention. Retry or dismiss one first.",
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
          error: actionErrorMessage(deleteError, "Could not undo capture"),
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
      setError(actionErrorMessage(copyError, "Could not copy capture text"));
    }
  }, []);

  const discardCapture = useCallback(
    (capture: InboxCapture) => {
      if (
        !window.confirm(
          `Discard the unsaved capture “${capture.title}”? This cannot be undone.`,
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
      if (creating) return;
      const form = event.currentTarget;
      const data = new FormData(form);
      const value = String(data.get("item") ?? "").trim();
      if (!value) {
        inputRef.current?.focus();
        return;
      }
      if (capturesInPlace && !captureQueueReady) {
        setError("Finishing capture recovery. Your text is still here.");
        inputRef.current?.focus();
        return;
      }

      const draft = parseItemInput(value);
      const capturePreview = capturesInPlace ? captureIntent(value) : null;
      const destination = destinationFor(
        capturePreview?.sourceUrl ?? draft.sourceUrl,
      );
      const template = defaultTemplateForFolder(destination);
      const type = compatibilityTypeForTemplate(template, draft.sourceUrl);
      const request: FolderCreateRequest =
        type === "bookmark"
          ? draft.sourceUrl
            ? {
                type,
                folderPath: destination.path,
                template,
                url: draft.sourceUrl,
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
      if (onCreateItem) {
        if (capturesInPlace) {
          if (
            queueInPlaceCapture(
              request,
              destination,
              capturePreview?.title ?? draft.title ?? "Untitled",
              value,
            )
          ) {
            form.reset();
          }
          return;
        }
        form.reset();
        onCreateItem(request, { open: true });
        return;
      }
      if (capturesInPlace) {
        setError("TextText could not start this capture.");
        return;
      }

      form.reset();
      setCreating(true);
      startTransition(() => {
        const creation =
          request.type === "bookmark"
            ? request.blank
              ? createWorkspacePostAction(
                  handle,
                  "bookmark",
                  request.folderPath,
                  request.title,
                  request.template,
                  request.body,
                )
              : createFolderItemAction(handle, "bookmarks", {
                  folderPath: request.folderPath,
                  template: request.template,
                  url: request.url,
                })
            : request.type === "note"
              ? createFolderItemAction(handle, "notes", {
                  folderPath: request.folderPath,
                  template: request.template,
                  title: request.title,
                  body: request.body,
                })
              : createWorkspacePostAction(
                  handle,
                  "article",
                  request.folderPath,
                  request.title,
                  request.template,
                  request.body,
                );
        void creation
          .then((post) => {
            if (draft.sourceUrl) router.refresh();
            else router.push(blogPostEditPath(blog, post));
          })
          .catch((createError) => {
            setError(actionErrorMessage(createError, "Could not create item"));
            inputRef.current?.focus();
          })
          .finally(() => setCreating(false));
      });
    },
    [
      blog,
      capturesInPlace,
      captureQueueReady,
      creating,
      destinationFor,
      handle,
      onCreateItem,
      router,
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
          placeholder={
            capturesInPlace
              ? "Save a thought, note, link, or AI answer"
              : "Create something in this folder"
          }
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
          disabled={
            creating || (capturesInPlace && !captureQueueReady)
          }
        >
          <span aria-hidden="true">↑</span>
        </button>
      </form>
      {/* Only failures are worth a line on screen. A save that worked has
          already put the item in the list right below, and the receipt for it
          was just clutter (owner, 2026-09-04). A save that FAILED leaves no
          other trace, so that one stays. */}
      {failedCaptures.length > 0 && (
        <div className="universal-item-receipts" aria-label="Recent captures">
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
                      Retry
                    </button>
                    <details className="universal-item-receipt-raw">
                      <summary
                        className="ac-btn ac-btn-plain"
                        aria-label={`View unsaved text for ${capture.title}`}
                      >
                        View
                      </summary>
                      <pre>{capture.raw}</pre>
                    </details>
                    <button
                      type="button"
                      className="ac-btn ac-btn-plain"
                      aria-label={`Copy unsaved text for ${capture.title}`}
                      onClick={() => void copyCaptureRaw(capture)}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="ac-btn ac-btn-plain"
                      aria-label={`Discard unsaved capture ${capture.title}`}
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
