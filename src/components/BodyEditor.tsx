"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { MediaUploadError, uploadMedia } from "@/lib/upload";

export type BodyEditorHandle = {
  focus: () => void;
};

type BodyEditorProps = {
  value: string;
  onChange: (value: string) => void;
  toolbarHost?: HTMLElement | null;
};

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  depth?: number;
  url?: string;
  alt?: string | null;
  ordered?: boolean;
  start?: number | null;
  lang?: string | null;
};

type ActiveState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: "body" | "title" | "subheading";
  align: "left" | "center";
};

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

const initialActiveState: ActiveState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  block: "body",
  align: "left",
};

const textColors = [
  { label: "Ink", token: "--ink" },
  { label: "Blue", value: "#0066cc" },
  { label: "Red", value: "#af1e2d" },
] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function markdownToHtml(markdown: string): string {
  const tree = markdownProcessor.parse(markdown) as MarkdownNode;
  return (tree.children ?? []).map(blockNodeToHtml).join("");
}

function blockNodeToHtml(node: MarkdownNode): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${inlineNodesToHtml(node.children)}</p>`;
    case "heading": {
      const tag = node.depth === 3 ? "h3" : "h2";
      return `<${tag}>${inlineNodesToHtml(node.children)}</${tag}>`;
    }
    case "blockquote":
      return `<blockquote>${(node.children ?? []).map(blockNodeToHtml).join("")}</blockquote>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start =
        node.ordered && node.start && node.start > 1
          ? ` start="${node.start}"`
          : "";
      return `<${tag}${start}>${(node.children ?? []).map(listItemToHtml).join("")}</${tag}>`;
    }
    case "code": {
      const lang = node.lang ? ` class="language-${escapeAttribute(node.lang)}"` : "";
      return `<pre><code${lang}>${escapeHtml(node.value ?? "")}</code></pre>`;
    }
    case "thematicBreak":
      return "<hr>";
    case "html":
      return `<p>${escapeHtml(node.value ?? "")}</p>`;
    default:
      return inlineNodesToHtml([node]);
  }
}

function listItemToHtml(node: MarkdownNode): string {
  const children = node.children ?? [];
  return `<li>${children.map(blockNodeToHtml).join("")}</li>`;
}

function inlineNodesToHtml(nodes: MarkdownNode[] | undefined): string {
  return (nodes ?? []).map(inlineNodeToHtml).join("");
}

function inlineNodeToHtml(node: MarkdownNode): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.value ?? "");
    case "strong":
      return `<strong>${inlineNodesToHtml(node.children)}</strong>`;
    case "emphasis":
      return `<em>${inlineNodesToHtml(node.children)}</em>`;
    case "delete":
      return `<s>${inlineNodesToHtml(node.children)}</s>`;
    case "inlineCode":
      return `<code>${escapeHtml(node.value ?? "")}</code>`;
    case "break":
      return "<br>";
    case "link": {
      const href = escapeAttribute(node.url ?? "");
      return `<a href="${href}">${inlineNodesToHtml(node.children)}</a>`;
    }
    case "image": {
      const src = escapeAttribute(node.url ?? "");
      const alt = escapeAttribute(node.alt ?? "");
      const caption = node.alt
        ? `<span class="reader-figcaption">${escapeHtml(node.alt)}</span>`
        : "";
      return `<span class="reader-figure"><img src="${src}" alt="${alt}" loading="lazy">${caption}</span>`;
    }
    case "html":
      return escapeHtml(node.value ?? "");
    default:
      return inlineNodesToHtml(node.children);
  }
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\~")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function cleanMarkdownBlock(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function childrenToInlineMarkdown(node: Node): string {
  return Array.from(node.childNodes).map(nodeToInlineMarkdown).join("");
}

function nodeToInlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdownText(node.textContent ?? "");
  }

  if (!(node instanceof HTMLElement)) return "";

  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "img") {
    const src = node.getAttribute("src") ?? "";
    const alt = node.getAttribute("alt") ?? "";
    return src ? `![${escapeMarkdownText(alt)}](${src})` : "";
  }
  if (tag === "strong" || tag === "b") {
    const value = childrenToInlineMarkdown(node);
    return value ? `**${value}**` : "";
  }
  if (tag === "em" || tag === "i") {
    const value = childrenToInlineMarkdown(node);
    return value ? `*${value}*` : "";
  }
  if (tag === "s" || tag === "strike" || tag === "del") {
    const value = childrenToInlineMarkdown(node);
    return value ? `~~${value}~~` : "";
  }
  if (tag === "code") {
    const value = (node.textContent ?? "").replace(/`/g, "\\`");
    return value ? `\`${value}\`` : "";
  }
  if (tag === "a") {
    const href = node.getAttribute("href") ?? "";
    const label = childrenToInlineMarkdown(node) || href;
    return href ? `[${label}](${href})` : label;
  }
  if (node.classList.contains("reader-figure")) {
    const image = node.querySelector("img");
    if (!image) return childrenToInlineMarkdown(node);
    const src = image.getAttribute("src") ?? "";
    const caption =
      node.querySelector(".reader-figcaption")?.textContent?.trim() ||
      image.getAttribute("alt") ||
      "";
    return src ? `![${escapeMarkdownText(caption)}](${src})` : "";
  }

  return childrenToInlineMarkdown(node);
}

function blockToMarkdown(node: Node, index = 1): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return cleanMarkdownBlock(escapeMarkdownText(node.textContent ?? ""));
  }
  if (!(node instanceof HTMLElement)) return "";

  const tag = node.tagName.toLowerCase();

  if (tag === "h2") return `## ${cleanMarkdownBlock(childrenToInlineMarkdown(node))}`;
  if (tag === "h3") return `### ${cleanMarkdownBlock(childrenToInlineMarkdown(node))}`;
  if (tag === "blockquote") {
    const value = serializeChildren(node);
    return value
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }
  if (tag === "ul" || tag === "ol") return listToMarkdown(node, tag === "ol");
  if (tag === "li") {
    const value = serializeChildren(node) || childrenToInlineMarkdown(node);
    return `${index}. ${cleanMarkdownBlock(value)}`;
  }
  if (tag === "pre") {
    const code = node.textContent?.replace(/\n+$/g, "") ?? "";
    return code ? `\`\`\`\n${code}\n\`\`\`` : "";
  }
  if (tag === "hr") return "---";
  if (tag === "img") return nodeToInlineMarkdown(node);

  return cleanMarkdownBlock(childrenToInlineMarkdown(node));
}

function listToMarkdown(list: HTMLElement, ordered: boolean): string {
  const items = Array.from(list.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li",
  );
  return items
    .map((item, itemIndex) => {
      const marker = ordered ? `${itemIndex + 1}.` : "-";
      const blocks = Array.from(item.childNodes)
        .map((child) => blockToMarkdown(child, itemIndex + 1))
        .filter(Boolean);
      const value = cleanMarkdownBlock(blocks.join("\n"));
      const indented = value.replace(/\n/g, "\n  ");
      return `${marker} ${indented}`;
    })
    .join("\n");
}

function serializeChildren(root: HTMLElement): string {
  return Array.from(root.childNodes)
    .map((child, index) => blockToMarkdown(child, index + 1))
    .map(cleanMarkdownBlock)
    .filter(Boolean)
    .join("\n\n");
}

function editorMarkdown(root: HTMLElement): string {
  return `${serializeChildren(root).trim()}`;
}

function closestElement(node: Node | null): HTMLElement | null {
  if (!node) return null;
  return node instanceof HTMLElement ? node : node.parentElement;
}

function closestBlock(node: Node | null, root: HTMLElement): HTMLElement {
  let current = closestElement(node);
  while (current && current !== root) {
    const tag = current.tagName.toLowerCase();
    if (
      tag === "p" ||
      tag === "div" ||
      tag === "h2" ||
      tag === "h3" ||
      tag === "li" ||
      tag === "blockquote"
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return root;
}

function selectionIsInside(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer);
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
  function BodyEditor({ value, onChange, toolbarHost }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const savedRangeRef = useRef<Range | null>(null);
    const lastEmittedRef = useRef(value);
    const [mounted, setMounted] = useState(false);
    const [editorHtml, setEditorHtml] = useState(() => markdownToHtml(value));
    const [active, setActive] = useState<ActiveState>(initialActiveState);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    useEffect(() => {
      setMounted(true);
    }, []);

    useEffect(() => {
      if (value === lastEmittedRef.current) return;
      lastEmittedRef.current = value;
      setEditorHtml(markdownToHtml(value));
    }, [value]);

    const saveSelection = useCallback(() => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return;
      savedRangeRef.current = range.cloneRange();
    }, []);

    const placeCaretAtEnd = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      savedRangeRef.current = range.cloneRange();
    }, []);

    const restoreSelection = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      const range = savedRangeRef.current;
      if (range && editor.contains(range.commonAncestorContainer)) {
        selection?.addRange(range);
      } else {
        placeCaretAtEnd();
      }
    }, [placeCaretAtEnd]);

    const emitMarkdown = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const next = editorMarkdown(editor);
      lastEmittedRef.current = next;
      onChange(next);
    }, [onChange]);

    const updateActiveState = useCallback(() => {
      const editor = editorRef.current;
      if (!editor || !selectionIsInside(editor)) return;

      const selection = window.getSelection();
      const block = closestBlock(selection?.anchorNode ?? null, editor);
      const tag = block.tagName.toLowerCase();
      const textAlign = window.getComputedStyle(block).textAlign;
      setActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
        block:
          tag === "h2" ? "title" : tag === "h3" ? "subheading" : "body",
        align: textAlign === "center" ? "center" : "left",
      });
    }, []);

    const runCommand = useCallback(
      (command: string, argument?: string) => {
        restoreSelection();
        document.execCommand(command, false, argument);
        saveSelection();
        emitMarkdown();
        updateActiveState();
      },
      [emitMarkdown, restoreSelection, saveSelection, updateActiveState],
    );

    const applyBlock = useCallback(
      (block: ActiveState["block"]) => {
        const tag = block === "title" ? "h2" : block === "subheading" ? "h3" : "p";
        runCommand("formatBlock", tag);
      },
      [runCommand],
    );

    const applyColor = useCallback(
      (color: (typeof textColors)[number]) => {
        const editor = editorRef.current;
        if (!editor) return;
        const styles = window.getComputedStyle(editor);
        const resolved =
          "token" in color
            ? styles.getPropertyValue(color.token).trim() || styles.color
            : color.value;
        runCommand("foreColor", resolved);
      },
      [runCommand],
    );

    const chooseImage = useCallback(() => {
      saveSelection();
      fileInputRef.current?.click();
    }, [saveSelection]);

    const insertImage = useCallback(
      async (file: File) => {
        setUploading(true);
        setUploadError(null);
        try {
          const url = await uploadMedia(file);
          restoreSelection();
          document.execCommand("insertImage", false, url);
          saveSelection();
          emitMarkdown();
          updateActiveState();
        } catch (error) {
          setUploadError(uploadErrorMessage(error));
        } finally {
          setUploading(false);
        }
      },
      [emitMarkdown, restoreSelection, saveSelection, updateActiveState],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const editor = editorRef.current;
          if (!editor) return;
          editor.focus({ preventScroll: true });
          placeCaretAtEnd();
        },
      }),
      [placeCaretAtEnd],
    );

    useEffect(() => {
      const onSelectionChange = () => {
        const editor = editorRef.current;
        if (!editor || !selectionIsInside(editor)) return;
        saveSelection();
        updateActiveState();
      };
      document.addEventListener("selectionchange", onSelectionChange);
      return () => {
        document.removeEventListener("selectionchange", onSelectionChange);
      };
    }, [saveSelection, updateActiveState]);

    const toolbar = useMemo(
      () => (
        <div className="body-editor-toolbar-shell">
          <div className="body-editor-toolbar applecms" role="toolbar" aria-label="Body formatting">
            <div className="body-editor-toolgroup" aria-label="Inline style">
              <ToolbarButton label="Bold" active={active.bold} onPress={() => runCommand("bold")}>
                <BoldIcon />
              </ToolbarButton>
              <ToolbarButton label="Italic" active={active.italic} onPress={() => runCommand("italic")}>
                <ItalicIcon />
              </ToolbarButton>
              <ToolbarButton label="Underline" active={active.underline} onPress={() => runCommand("underline")}>
                <UnderlineIcon />
              </ToolbarButton>
              <ToolbarButton label="Strikethrough" active={active.strike} onPress={() => runCommand("strikeThrough")}>
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
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyBlock(valueName as ActiveState["block"]);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="body-editor-toolgroup is-color" aria-label="Text color">
              <span className="body-editor-label">Color</span>
              {textColors.map((color) => (
                <button
                  key={color.label}
                  type="button"
                  className="body-editor-color-tool"
                  aria-label={color.label}
                  title={color.label}
                  style={{
                    "--body-editor-swatch":
                      "token" in color
                        ? `var(${color.token}, var(--ink))`
                        : color.value,
                  } as CSSProperties}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyColor(color);
                  }}
                />
              ))}
            </div>
            <div className="body-editor-toolgroup" aria-label="Alignment">
              <ToolbarButton label="Align left" active={active.align === "left"} onPress={() => runCommand("justifyLeft")}>
                <AlignLeftIcon />
              </ToolbarButton>
              <ToolbarButton label="Align center" active={active.align === "center"} onPress={() => runCommand("justifyCenter")}>
                <AlignCenterIcon />
              </ToolbarButton>
            </div>
            <div className="body-editor-toolgroup" aria-label="Media">
              <ToolbarButton label="Insert image" disabled={uploading} onPress={chooseImage}>
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
      ),
      [
        active.align,
        active.block,
        active.bold,
        active.italic,
        active.strike,
        active.underline,
        applyBlock,
        applyColor,
        chooseImage,
        runCommand,
        uploadError,
        uploading,
      ],
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
          {mounted ? (
            <div
              ref={editorRef}
              className="body-editor-content"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Body"
              aria-multiline="true"
              data-placeholder="Start writing"
              dangerouslySetInnerHTML={{ __html: editorHtml }}
              onBlur={saveSelection}
              onInput={() => {
                saveSelection();
                emitMarkdown();
                updateActiveState();
              }}
              onKeyUp={() => {
                saveSelection();
                updateActiveState();
              }}
              onMouseUp={() => {
                saveSelection();
                updateActiveState();
              }}
              onFocus={() => {
                saveSelection();
                updateActiveState();
              }}
            />
          ) : (
            <div
              className="body-editor-content is-mounting"
              aria-hidden="true"
            />
          )}
        </div>
      </>
    );
  },
);
