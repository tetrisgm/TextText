"use client";

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";

type BodyEditorBlock = "body" | "heading1" | "heading2" | "heading3";

const BLOCK_OPTIONS: Array<{
  value: BodyEditorBlock;
  label: string;
  keys: string;
}> = [
  { value: "body", label: "Body", keys: "⌘⌥0" },
  { value: "heading1", label: "Heading 1", keys: "⌘⌥1" },
  { value: "heading2", label: "Heading 2", keys: "⌘⌥2" },
  { value: "heading3", label: "Heading 3", keys: "⌘⌥3" },
];

function bodyEditorBlock(editor: Editor): BodyEditorBlock {
  if (editor.isActive("heading", { level: 1 })) return "heading1";
  if (editor.isActive("heading", { level: 2 })) return "heading2";
  if (editor.isActive("heading", { level: 3 })) return "heading3";
  return "body";
}

function normalizeHref(value: string): string {
  const href = value.trim();
  if (!href) return "";
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return href;
  return `https://${href}`;
}

function applyBlock(editor: Editor, block: BodyEditorBlock) {
  const chain = editor.chain().focus();

  if (block === "body") {
    chain.setParagraph().run();
    return;
  }

  const level = Number(block.slice(-1)) as 1 | 2 | 3;
  chain.setHeading({ level }).run();
}

function applyLink(editor: Editor) {
  const previousHref =
    typeof editor.getAttributes("link").href === "string"
      ? editor.getAttributes("link").href
      : "";
  const nextHref = window.prompt("Link", previousHref);

  if (nextHref === null) return;

  const href = normalizeHref(nextHref);

  if (!href) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }

  editor
    .chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href })
    .run();
}

function ToolbarButton({
  label,
  keys,
  active,
  disabled,
  children,
  onPress,
}: {
  label: string;
  keys?: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onPress: () => void;
}) {
  return (
    <ShortcutTooltip label={label} keys={keys} placement="top">
      <button
        type="button"
        className={`body-editor-tool${active ? " is-active" : ""}`}
        aria-label={keys ? `${label} (${keys})` : label}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(event) => {
          event.preventDefault();
          if (!disabled) onPress();
        }}
      >
        {children}
      </button>
    </ShortcutTooltip>
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

function BulletListIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="4.25" cy="5" r="1.05" fill="currentColor" />
      <circle cx="4.25" cy="9" r="1.05" fill="currentColor" />
      <circle cx="4.25" cy="13" r="1.05" fill="currentColor" />
      <path
        d="M7.15 5h6.6M7.15 9h6.6M7.15 13h6.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function OrderedListIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M3.55 4.1h1.3v3M3.5 7.1h2.1M3.55 9.1h1.2c.55 0 .9.3.9.75 0 .3-.14.53-.43.74l-1.63 1.31h2.2M3.6 13.4h1.18c.53 0 .88.28.88.72 0 .42-.34.72-.86.72H3.58m0-1.44.02-1.22h2.02"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.15"
      />
      <path
        d="M8.1 5h6.35M8.1 9h6.35M8.1 13h6.35"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M3.15 4.95 4.1 5.9l1.7-2M3.15 9 4.1 9.95l1.7-2M3.15 13.05 4.1 14l1.7-2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
      <path
        d="M8 5h6.7M8 9h6.7M8 13h6.7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M7.75 5.15 8.7 4.2a3 3 0 0 1 4.25 4.25l-1.45 1.45a3 3 0 0 1-4.25 0M10.25 12.85l-.95.95a3 3 0 0 1-4.25-4.25L6.5 8.1a3 3 0 0 1 4.25 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
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

export function BodyEditorToolbar({
  editor,
  postType,
  mediaEnabled,
  uploading,
  uploadError,
  onChooseImage,
}: {
  editor: Editor | null;
  postType?: "article" | "project" | "talk" | "note" | "bookmark";
  mediaEnabled: boolean;
  uploading: boolean;
  uploadError: string | null;
  onChooseImage: () => void;
}) {
  const editorDisabled = !editor;
  const activeBlock = editor ? bodyEditorBlock(editor) : "body";
  const activeBlockOption =
    BLOCK_OPTIONS.find((option) => option.value === activeBlock) ??
    BLOCK_OPTIONS[0];
  const blockMenuRef = useRef<HTMLDivElement | null>(null);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const closeBlockMenu = useCallback(() => setBlockMenuOpen(false), []);
  useEscapeLayer(blockMenuOpen, "Text style", closeBlockMenu);

  useEffect(() => {
    if (!blockMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        blockMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      closeBlockMenu();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [blockMenuOpen, closeBlockMenu]);

  return (
    <div className="body-editor-toolbar-shell">
      <div
        className="body-editor-toolbar applecms"
        data-post-type={postType}
        role="toolbar"
        aria-label="Body formatting"
      >
        <div
          ref={blockMenuRef}
          className="body-editor-toolgroup is-text body-editor-block-picker"
          aria-label="Text style"
        >
          <ShortcutTooltip
            label="Text style"
            keys={activeBlockOption.keys}
            placement="top"
          >
            <button
              type="button"
              className={`body-editor-text-tool body-editor-block-trigger${
                blockMenuOpen ? " is-active" : ""
              }`}
              aria-haspopup="menu"
              aria-expanded={blockMenuOpen}
              disabled={editorDisabled}
              onMouseDown={(event) => {
                event.preventDefault();
                if (!editorDisabled) setBlockMenuOpen((open) => !open);
              }}
            >
              <span>{activeBlockOption.label}</span>
              <span className="body-editor-block-chevron" aria-hidden="true">
                ▾
              </span>
            </button>
          </ShortcutTooltip>
          {blockMenuOpen && editor && (
            <div
              className="body-editor-block-menu"
              role="menu"
              data-post-edit-menu-open="true"
              aria-label="Text style"
            >
              {BLOCK_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`body-editor-block-option${
                    activeBlock === option.value ? " is-active" : ""
                  }`}
                  role="menuitemradio"
                  aria-checked={activeBlock === option.value}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyBlock(editor, option.value);
                    closeBlockMenu();
                  }}
                >
                  <span>{option.label}</span>
                  <kbd>{option.keys}</kbd>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="body-editor-toolgroup" aria-label="Inline style">
          <ToolbarButton
            label="Bold"
            keys="⌘B"
            active={editor?.isActive("bold")}
            disabled={editorDisabled}
            onPress={() => editor?.chain().focus().toggleBold().run()}
          >
            <BoldIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            keys="⌘I"
            active={editor?.isActive("italic")}
            disabled={editorDisabled}
            onPress={() => editor?.chain().focus().toggleItalic().run()}
          >
            <ItalicIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Strikethrough"
            keys="⌘⇧X"
            active={editor?.isActive("strike")}
            disabled={editorDisabled}
            onPress={() => editor?.chain().focus().toggleStrike().run()}
          >
            <StrikeIcon />
          </ToolbarButton>
        </div>
        <div className="body-editor-toolgroup" aria-label="Lists">
          <ToolbarButton
            label="Bulleted list"
            keys="⌘⇧8"
            active={editor?.isActive("bulletList")}
            disabled={editorDisabled}
            onPress={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <BulletListIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Numbered list"
            keys="⌘⇧7"
            active={editor?.isActive("orderedList")}
            disabled={editorDisabled}
            onPress={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <OrderedListIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Checklist"
            keys="⌘⇧9"
            active={editor?.isActive("taskList")}
            disabled={editorDisabled}
            onPress={() => editor?.chain().focus().toggleTaskList().run()}
          >
            <ChecklistIcon />
          </ToolbarButton>
        </div>
        <div className="body-editor-toolgroup" aria-label="Insert">
          <ToolbarButton
            label="Link"
            keys="⌘K"
            active={editor?.isActive("link")}
            disabled={editorDisabled}
            onPress={() => {
              if (editor) applyLink(editor);
            }}
          >
            <LinkIcon />
          </ToolbarButton>
          {mediaEnabled && (
            <ToolbarButton
              label="Insert photo or video"
              keys="Drop or paste"
              disabled={editorDisabled || uploading}
              onPress={onChooseImage}
            >
              {uploading ? <span className="body-editor-spinner" /> : <ImageIcon />}
            </ToolbarButton>
          )}
        </div>
      </div>
      {uploadError && (
        <div className="body-editor-upload-error" role="alert">
          {uploadError}
        </div>
      )}
    </div>
  );
}
