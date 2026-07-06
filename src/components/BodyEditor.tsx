"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { SelectionBookmark } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { MediaUploadError, uploadMedia } from "@/lib/upload";

export type BodyEditorHandle = {
  focus: () => void;
};

type BodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
  toolbarHost?: HTMLElement | null;
  mediaEnabled?: boolean;
  uploadEndpoint?: string;
};

// Markdown is the source of truth for post bodies, so the toolbar only offers
// what markdown can round-trip: bold/italic/strike, headings, and images.
type ActiveState = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  block: "body" | "title" | "subheading";
};

type MarkdownStorage = {
  markdown?: {
    getMarkdown?: () => string;
  };
};

const initialActiveState: ActiveState = {
  bold: false,
  italic: false,
  strike: false,
  block: "body",
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

const editorExtensions = [
  StarterKit.configure({
    heading: {
      levels: [2, 3],
    },
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
  Markdown.configure({
    html: false,
    bulletListMarker: "-",
  }),
];

function editorMarkdown(editor: Editor): string {
  const storage = editor.storage as Editor["storage"] & MarkdownStorage;
  return storage.markdown?.getMarkdown?.() ?? "";
}

function activeState(editor: Editor | null): ActiveState {
  if (!editor) return initialActiveState;

  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    block: editor.isActive("heading", { level: 2 })
      ? "title"
      : editor.isActive("heading", { level: 3 })
        ? "subheading"
        : "body",
  };
}

function uploadErrorMessage(error: unknown): string {
  return error instanceof MediaUploadError
    ? error.message
    : error instanceof Error && error.message
      ? error.message
      : "Upload failed.";
}

function ToolbarButton({
  label,
  active,
  disabled,
  children,
  onPress,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className={`body-editor-tool${active ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault();
        if (!disabled) onPress();
      }}
    >
      {children}
    </button>
  );
}

function BoldIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M5.5 3.25h4.1c2 0 3.2 1.02 3.2 2.65 0 1.05-.52 1.82-1.45 2.16 1.2.3 1.9 1.2 1.9 2.48 0 1.9-1.42 3.02-3.72 3.02H5.5V3.25Zm2.05 4.18h1.82c.88 0 1.36-.42 1.36-1.17 0-.74-.5-1.13-1.42-1.13H7.55v2.3Zm0 4.24h1.95c1.06 0 1.62-.45 1.62-1.28 0-.84-.58-1.3-1.68-1.3H7.55v2.58Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ItalicIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M7.4 3.25h6.1l-.28 1.58h-2.03l-1.56 7.14h2.05l-.34 1.58H5.24l.34-1.58h2.02l1.56-7.14H7.12l.28-1.58Z"
        fill="currentColor"
      />
    </svg>
  );
}

function StrikeIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M9.34 2.9c2.02 0 3.34.95 3.82 2.64l-1.72.48c-.28-.94-1.02-1.43-2.12-1.43-1.08 0-1.78.45-1.78 1.16 0 .56.42.9 1.46 1.16l1.15.28c2.05.5 3.05 1.5 3.05 3.04 0 1.97-1.54 3.18-4.02 3.18-2.2 0-3.8-1.02-4.28-2.88l1.76-.44c.34 1.08 1.22 1.62 2.6 1.62 1.18 0 1.94-.48 1.94-1.22 0-.58-.44-.94-1.56-1.22l-1.18-.3c-1.94-.48-2.9-1.45-2.9-2.94C5.56 4.03 7.04 2.9 9.34 2.9Z"
        fill="currentColor"
      />
      <path d="M3.3 8.65h11.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M4.25 4.25h9.5v9.5h-9.5v-9.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path
        d="m5.7 12.1 2.15-2.35 1.45 1.52 1.88-2.35 1.42 3.18H5.7Z"
        fill="currentColor"
      />
      <circle cx="11.55" cy="6.65" r="1" fill="currentColor" />
    </svg>
  );
}

export const BodyEditor = forwardRef<BodyEditorHandle, BodyEditorProps>(
  function BodyEditor(
    { value, onChange, toolbarHost, mediaEnabled = true, uploadEndpoint },
    ref,
  ) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const lastEmittedRef = useRef(value);
    const onChangeRef = useRef(onChange);
    const selectionBookmarkRef = useRef<SelectionBookmark | null>(null);
    const mounted = useSyncExternalStore(
      subscribeClientSnapshot,
      getClientMounted,
      getServerMounted,
    );
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    const saveSelectionBookmark = useCallback((editor: Editor) => {
      selectionBookmarkRef.current = editor.state.selection.getBookmark();
    }, []);

    const editor = useEditor({
      extensions: editorExtensions,
      content: value,
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
    });

    useEffect(() => {
      if (!editor) return;
      if (value === lastEmittedRef.current) return;

      lastEmittedRef.current = value;
      editor.commands.setContent(value, false);
    }, [editor, value]);

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

    const applyBlock = useCallback(
      (block: ActiveState["block"]) => {
        if (!editor) return;
        const chain = editor.chain().focus();

        if (block === "body") {
          chain.setParagraph().run();
          return;
        }

        chain
          .toggleHeading({ level: block === "title" ? 2 : 3 })
          .run();
      },
      [editor],
    );

    const chooseImage = useCallback(() => {
      if (!editor || !mediaEnabled) return;
      saveSelectionBookmark(editor);
      fileInputRef.current?.click();
    }, [editor, mediaEnabled, saveSelectionBookmark]);

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

    const active = activeState(editor);
    const editorDisabled = !editor;

    const toolbar = (
      <div className="body-editor-toolbar-shell">
        <div className="body-editor-toolbar applecms" role="toolbar" aria-label="Body formatting">
          <div className="body-editor-toolgroup" aria-label="Inline style">
            <ToolbarButton
              label="Bold"
              active={active.bold}
              disabled={editorDisabled}
              onPress={() => editor?.chain().focus().toggleBold().run()}
            >
              <BoldIcon />
            </ToolbarButton>
            <ToolbarButton
              label="Italic"
              active={active.italic}
              disabled={editorDisabled}
              onPress={() => editor?.chain().focus().toggleItalic().run()}
            >
              <ItalicIcon />
            </ToolbarButton>
            <ToolbarButton
              label="Strikethrough"
              active={active.strike}
              disabled={editorDisabled}
              onPress={() => editor?.chain().focus().toggleStrike().run()}
            >
              <StrikeIcon />
            </ToolbarButton>
          </div>
          <div className="body-editor-toolgroup is-text" aria-label="Text size">
            {[
              ["body", "Body"],
              ["title", "Title"],
              ["subheading", "Sub"],
            ].map(([valueName, label]) => (
              <button
                key={valueName}
                type="button"
                className={`body-editor-text-tool${active.block === valueName ? " is-active" : ""}`}
                aria-pressed={active.block === valueName}
                disabled={editorDisabled}
                onMouseDown={(event) => {
                  event.preventDefault();
                  if (!editorDisabled) applyBlock(valueName as ActiveState["block"]);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {mediaEnabled && (
            <div className="body-editor-toolgroup" aria-label="Media">
              <ToolbarButton
                label="Insert image"
                disabled={editorDisabled || uploading}
                onPress={chooseImage}
              >
                {uploading ? <span className="body-editor-spinner" /> : <ImageIcon />}
              </ToolbarButton>
            </div>
          )}
        </div>
        {uploadError && (
          <div className="body-editor-upload-error" role="alert">
            {uploadError}
          </div>
        )}
      </div>
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
