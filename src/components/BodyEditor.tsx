"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { AnyExtension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { SelectionBookmark } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { Markdown } from "tiptap-markdown";
import { BodyEditorToolbar } from "@/components/BodyEditorToolbar";
import { SlashCommand } from "@/components/editor/SlashCommand";
import { MediaUploadError, uploadMedia } from "@/lib/upload";
import { CollabProvider } from "@/lib/collab/provider";
import type { PresencePeer } from "@/lib/collab/provider";

export type BodyEditorHandle = {
  focus: () => void;
};

export type BodyEditorCollab = {
  /** the post being co-edited; the relay is keyed by it */
  postId: string;
  /** display name shown to other editors */
  userName: string;
  /** cursor/presence color, "#rrggbb" */
  color: string;
  /** editors push changes; viewers follow along read-only */
  canEdit: boolean;
};

type BodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
  toolbarHost?: HTMLElement | null;
  postType?: "article" | "project" | "talk" | "note" | "bookmark";
  mediaEnabled?: boolean;
  uploadEndpoint?: string;
  /** when present, the body is a shared Yjs document (realtime co-editing) */
  collab?: BodyEditorCollab | null;
  onPresence?: (peers: PresencePeer[]) => void;
};

// Markdown is the source of truth for post bodies, so the toolbar only offers
// formatting that can round-trip, including GFM task items.

type MarkdownStorage = {
  markdown?: {
    getMarkdown?: () => string;
  };
};

type SlashCommandConfig = {
  mediaEnabled: boolean;
  onChooseImage: () => void;
};

function subscribeClientSnapshot() {
  return () => {};
}

function getClientMounted() {
  return true;
}

function getServerMounted() {
  return false;
}

// Collaboration replaces the editor's undo history with Yjs's, so StarterKit's
// own history MUST be disabled when a shared document is present, and enabled
// otherwise (solo editing keeps normal undo/redo).
function buildEditorExtensions(
  ydoc: Y.Doc | null,
  slashCommand: SlashCommandConfig,
): AnyExtension[] {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      ...(ydoc ? { history: false } : {}),
    }),
    Image,
    Link.configure({
      autolink: true,
      linkOnPaste: true,
      openOnClick: false,
    }),
    Placeholder.configure({
      placeholder: "Start writing",
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    SlashCommand.configure({
      mediaEnabled: slashCommand.mediaEnabled,
      onChooseImage: slashCommand.onChooseImage,
    }),
    Markdown.configure({
      html: false,
      bulletListMarker: "-",
    }),
  ];
  if (ydoc) {
    extensions.push(Collaboration.configure({ document: ydoc }));
  }
  return extensions;
}

function editorMarkdown(editor: Editor): string {
  const storage = editor.storage as Editor["storage"] & MarkdownStorage;
  return storage.markdown?.getMarkdown?.() ?? "";
}

function uploadErrorMessage(error: unknown): string {
  return error instanceof MediaUploadError
    ? error.message
    : error instanceof Error && error.message
      ? error.message
      : "Upload failed.";
}

export const BodyEditor = forwardRef<BodyEditorHandle, BodyEditorProps>(
  function BodyEditor(
    {
      value,
      onChange,
      toolbarHost,
      postType,
      mediaEnabled = true,
      uploadEndpoint,
      collab,
      onPresence,
    },
    ref,
  ) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const slashChooseImageRef = useRef<() => void>(() => {});
    const lastEmittedRef = useRef(value);
    const onChangeRef = useRef(onChange);
    const collabRef = useRef(collab);
    const onPresenceRef = useRef(onPresence);
    const initialValueRef = useRef(value);
    const selectionBookmarkRef = useRef<SelectionBookmark | null>(null);
    const mounted = useSyncExternalStore(
      subscribeClientSnapshot,
      getClientMounted,
      getServerMounted,
    );
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const collabPostId = collab?.postId ?? null;

    collabRef.current = collab;
    onPresenceRef.current = onPresence;

    // One Y.Doc per co-edited post, created before the editor so the
    // Collaboration extension can bind to it. Null (and no collab) for solo
    // editing, which keeps the exact previous behavior.
    const ydoc = useMemo(
      () => (collabPostId === null ? null : new Y.Doc()),
      [collabPostId],
    );
    const extensions = useMemo(
      () =>
        buildEditorExtensions(ydoc, {
          mediaEnabled,
          onChooseImage: () => slashChooseImageRef.current(),
        }),
      [mediaEnabled, ydoc],
    );

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    const saveSelectionBookmark = useCallback((editor: Editor) => {
      selectionBookmarkRef.current = editor.state.selection.getBookmark();
    }, []);

    const editor = useEditor(
      {
        extensions,
        // With collab, Yjs owns the content; seeding happens after sync.
        content: ydoc ? undefined : value,
        immediatelyRender: false,
        editorProps: {
          attributes: {
            class: "body-editor-content",
            role: "textbox",
            "aria-label": "Body",
            "aria-multiline": "true",
          },
        },
        onSelectionUpdate: ({ editor }) => {
          saveSelectionBookmark(editor);
        },
        onFocus: ({ editor }) => {
          saveSelectionBookmark(editor);
        },
        onUpdate: ({ editor }) => {
          const next = editorMarkdown(editor);
          lastEmittedRef.current = next;
          onChangeRef.current(next);
        },
      },
    );

    useEffect(() => {
      // In collab mode Yjs is the source of truth; never push `value` into the
      // editor or it would fight the shared document.
      if (ydoc) return;
      if (!editor) return;
      if (value === lastEmittedRef.current) return;

      lastEmittedRef.current = value;
      editor.commands.setContent(value, false);
    }, [editor, value, ydoc]);

    // Realtime provider lifecycle: connect the shared doc, seed it from the
    // saved markdown the first time (empty history), and track presence.
    useEffect(() => {
      const initialCollab = collabRef.current;
      if (
        !editor ||
        !ydoc ||
        collabPostId === null ||
        !initialCollab ||
        initialCollab.postId !== collabPostId
      ) {
        onPresenceRef.current?.([]);
        return;
      }
      let cancelled = false;
      onPresenceRef.current?.([]);
      const currentCollab = () => {
        const next = collabRef.current;
        return next?.postId === collabPostId ? next : initialCollab;
      };
      const provider = new CollabProvider(ydoc, {
        postId: collabPostId,
        get userName() {
          return currentCollab().userName;
        },
        get color() {
          return currentCollab().color;
        },
        get canPush() {
          return currentCollab().canEdit;
        },
        onPresence: (list) => {
          if (!cancelled) onPresenceRef.current?.(list);
        },
      });
      void provider.start().then(() => {
        if (cancelled) return;
        // Seed only when this client caught up to an EMPTY document and is
        // allowed to write. Owner-edits-first-then-shares means history is
        // normally already present by the time a second editor joins.
        const fragmentEmpty = ydoc.getXmlFragment("default").length === 0;
        if (
          currentCollab().canEdit &&
          fragmentEmpty &&
          initialValueRef.current.trim()
        ) {
          editor.commands.setContent(initialValueRef.current, false);
        }
      });
      return () => {
        cancelled = true;
        onPresenceRef.current?.([]);
        provider.destroy();
      };
    }, [editor, ydoc, collabPostId]);

    const restoreSelectionBookmark = useCallback((editor: Editor) => {
      const bookmark = selectionBookmarkRef.current;
      if (!bookmark) return;

      try {
        const selection = bookmark.resolve(editor.state.doc);
        editor.view.dispatch(editor.state.tr.setSelection(selection));
      } catch {
        selectionBookmarkRef.current = null;
      }
    }, []);

    const chooseImage = useCallback(() => {
      if (!editor || !mediaEnabled) return;
      saveSelectionBookmark(editor);
      fileInputRef.current?.click();
    }, [editor, mediaEnabled, saveSelectionBookmark]);
    slashChooseImageRef.current = chooseImage;

    const insertImage = useCallback(
      async (file: File) => {
        if (!editor) return;

        setUploading(true);
        setUploadError(null);
        try {
          const url = await uploadMedia(file, { endpoint: uploadEndpoint });
          restoreSelectionBookmark(editor);
          editor.chain().focus().setImage({ src: url }).run();
          saveSelectionBookmark(editor);
        } catch (error) {
          setUploadError(uploadErrorMessage(error));
        } finally {
          setUploading(false);
        }
      },
      [editor, restoreSelectionBookmark, saveSelectionBookmark, uploadEndpoint],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editor?.commands.focus("end", { scrollIntoView: false });
        },
      }),
      [editor],
    );

    const toolbar = (
      <BodyEditorToolbar
        editor={editor}
        postType={postType}
        mediaEnabled={mediaEnabled}
        uploading={uploading}
        uploadError={uploadError}
        onChooseImage={chooseImage}
      />
    );

    return (
      <>
        {mounted && (toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar)}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void insertImage(file);
          }}
        />
        <div className="body-editor">
          {mounted && editor ? (
            <EditorContent editor={editor} />
          ) : (
            <div
              className="body-editor-content is-mounting"
              data-placeholder="Start writing"
              aria-hidden="true"
            />
          )}
        </div>
      </>
    );
  },
);
