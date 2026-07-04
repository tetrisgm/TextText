"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import type { SelectionBookmark } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
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
  uploadEndpoint?: string;
};

type ActiveState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: "body" | "title" | "subheading";
  align: "left" | "center";
};

type MarkdownStorage = {
  markdown?: {
    getMarkdown?: () => string;
  };
};

const initialActiveState: ActiveState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  block: "body",
  align: "left",
};

const textColors = [
  { label: "Ink", token: "--ink", value: null },
  { label: "Blue", value: "#0066cc" },
  { label: "Red", value: "#af1e2d" },
] as const;

const MarkdownUnderline = Underline.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "", close: "" },
      },
    };
  },
});

const MarkdownTextStyle = TextStyle.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: "", close: "" },
      },
    };
  },
});

const editorExtensions = [
  StarterKit.configure({
    heading: {
      levels: [2, 3],
    },
  }),
  MarkdownUnderline,
  TextAlign.configure({
    types: ["heading", "paragraph"],
    alignments: ["left", "center"],
  }),
  MarkdownTextStyle,
  Color,
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
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    block: editor.isActive("heading", { level: 2 })
      ? "title"
      : editor.isActive("heading", { level: 3 })
        ? "subheading"
        : "body",
    align: editor.isActive({ textAlign: "center" }) ? "center" : "left",
  };
}

function colorIsActive(
  editor: Editor | null,
  color: (typeof textColors)[number],
): boolean {
  if (!editor) return false;
  if (color.value) return editor.isActive("textStyle", { color: color.value });

  return !textColors.some(
    (item) => item.value && editor.isActive("textStyle", { color: item.value }),
  );
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

function UnderlineIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M5.1 3.15h1.95v5.7c0 1.68.72 2.58 1.96 2.58 1.22 0 1.94-.9 1.94-2.58v-5.7h1.95v5.76c0 2.72-1.48 4.28-3.9 4.28-2.43 0-3.9-1.56-3.9-4.28V3.15Z"
        fill="currentColor"
      />
      <path d="M4.3 15h9.4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
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

function AlignLeftIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3.5 4.5h11M3.5 7.6h7.5M3.5 10.7h11M3.5 13.8h7.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function AlignCenterIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3.5 4.5h11M5.25 7.6h7.5M3.5 10.7h11M5.25 13.8h7.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
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
  function BodyEditor({ value, onChange, toolbarHost, uploadEndpoint }, ref) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const lastEmittedRef = useRef(value);
    const onChangeRef = useRef(onChange);
    const selectionBookmarkRef = useRef<SelectionBookmark | null>(null);
    const [mounted, setMounted] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      setMounted(true);
    }, []);

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

    const applyColor = useCallback(
      (color: (typeof textColors)[number]) => {
        if (!editor) return;
        const chain = editor.chain().focus();

        if (color.value) {
          chain.setColor(color.value).run();
        } else {
          chain.unsetColor().run();
        }
      },
      [editor],
    );

    const chooseImage = useCallback(() => {
      if (!editor) return;
      saveSelectionBookmark(editor);
      fileInputRef.current?.click();
    }, [editor, saveSelectionBookmark]);

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
              label="Underline"
              active={active.underline}
              disabled={editorDisabled}
              onPress={() => editor?.chain().focus().toggleUnderline().run()}
            >
              <UnderlineIcon />
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
          <div className="body-editor-toolgroup is-color" aria-label="Text color">
            <span className="body-editor-label">Color</span>
            {textColors.map((color) => {
              const isActive = colorIsActive(editor, color);

              return (
                <button
                  key={color.label}
                  type="button"
                  className={`body-editor-color-tool${isActive ? " is-active" : ""}`}
                  aria-label={color.label}
                  aria-pressed={isActive}
                  title={color.label}
                  disabled={editorDisabled}
                  style={{
                    "--body-editor-swatch":
                      "token" in color
                        ? `var(${color.token}, var(--ink))`
                        : color.value,
                  } as CSSProperties}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (!editorDisabled) applyColor(color);
                  }}
                />
              );
            })}
          </div>
          <div className="body-editor-toolgroup" aria-label="Alignment">
            <ToolbarButton
              label="Align left"
              active={active.align === "left"}
              disabled={editorDisabled}
              onPress={() => editor?.chain().focus().setTextAlign("left").run()}
            >
              <AlignLeftIcon />
            </ToolbarButton>
            <ToolbarButton
              label="Align center"
              active={active.align === "center"}
              disabled={editorDisabled}
              onPress={() => editor?.chain().focus().setTextAlign("center").run()}
            >
              <AlignCenterIcon />
            </ToolbarButton>
          </div>
          <div className="body-editor-toolgroup" aria-label="Media">
            <ToolbarButton
              label="Insert image"
              disabled={editorDisabled || uploading}
              onPress={chooseImage}
            >
              {uploading ? <span className="body-editor-spinner" /> : <ImageIcon />}
            </ToolbarButton>
          </div>
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
