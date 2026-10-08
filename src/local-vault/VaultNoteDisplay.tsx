import { NoteIcon } from "@/components/document/NoteIconControl";
"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { noteCardIdFromHref } from "@/lib/note-card-links";
import { noteColor } from "@/lib/note-colors";
import { VaultCardBacklinks } from "./VaultCardBacklinks";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";

const taskMarker = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\](?=\s|$))/;

export function toggleNoteTask(body: string, index: number): string | null {
  let count = 0, offset = 0, fence: string | null = null;
  for (const line of body.split("\n")) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    if (delimiter && (!fence || (delimiter[0] === fence[0] && delimiter.length >= fence.length))) {
      fence = fence ? null : delimiter;
      offset += line.length + 1;
      continue;
    }
    const match = fence ? null : taskMarker.exec(line);
    if (match) {
      if (count === index) {
        const at = offset + match[1].length;
        return `${body.slice(0, at)}${match[2] === " " ? "x" : " "}${body.slice(at + 1)}`;
      }
      count++;
    }
    offset += line.length + 1;
  }
  return null;
}

export function VaultNoteDisplay({ document, template, sourceBody = document.content.body, itemId, onEdit, onToggleTask, onOpenCardId, onOpenCardPath }: { document: DocumentSnapshot; template: TemplateDefinition; sourceBody?: string; itemId?: string; onEdit?: () => void; onToggleTask?: (index: number, sourceBody: string) => void; onOpenCardId?: (id: string) => Promise<void>; onOpenCardPath?: (path: string) => void }) {
  const cardRef = useRef<HTMLElement>(null);
  const [linkError, setLinkError] = useState("");
  useLayoutEffect(() => {
    if (!onToggleTask) return;
    cardRef.current?.querySelectorAll<HTMLElement>('.tt-prose[data-tt-bind="content.body"] li.task-list-item').forEach(item => {
      item.tabIndex = 0;
      item.setAttribute("role", "checkbox");
      item.setAttribute("aria-checked", String(Boolean(item.querySelector("input[type=checkbox]:checked"))));
      item.setAttribute("aria-label", item.textContent?.trim() || "Checklist item");
      item.querySelector("input[type=checkbox]")?.setAttribute("aria-hidden", "true");
    });
  }, [document.content.body, onToggleTask]);
  const taskIndex = (target: EventTarget | null) => {
    const item = target instanceof Element ? target.closest('.tt-prose[data-tt-bind="content.body"] li.task-list-item') : null;
    if (!item || !cardRef.current?.contains(item)) return -1;
    return Array.from(cardRef.current.querySelectorAll('.tt-prose[data-tt-bind="content.body"] li.task-list-item')).indexOf(item);
  };
  return <section ref={cardRef} className="vault-note-display" data-note-color={noteColor(document.content.fields.texttextNoteColor)} aria-label="Note card" tabIndex={onEdit ? 0 : undefined}
    onClickCapture={onOpenCardId ? event => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const id = anchor && cardRef.current?.contains(anchor) ? noteCardIdFromHref(anchor.getAttribute("href") ?? "") : null;
      if (!id) return;
      event.preventDefault();
      void onOpenCardId(id).catch(reason => setLinkError(reason instanceof Error ? reason.message : "The linked card could not be opened."));
    } : undefined}
    onClick={onEdit ? (event) => {
      const index = taskIndex(event.target);
      if (index >= 0 && onToggleTask) { onToggleTask(index, sourceBody); return; }
      if (event.target instanceof Element && !event.target.closest("a, button, input, textarea, [contenteditable]")) event.currentTarget.focus();
    } : undefined}
    onKeyDown={onEdit ? (event) => {
      const index = taskIndex(event.target);
      if (index >= 0 && onToggleTask && (event.key === " " || event.key === "Enter")) { event.preventDefault(); onToggleTask(index, sourceBody); return; }
      if (event.target === event.currentTarget && event.key === "Enter") { event.preventDefault(); onEdit(); }
    } : undefined}>
    {onEdit && <div className="vault-note-display-actions"><button type="button" onClick={onEdit} aria-label="Edit card" title="Edit card"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z"/></svg></button></div>}
    <NoteIcon value={document.content.fields.texttextNoteIcon}/>
    <DocumentRenderer document={document} template={template} />
    {itemId && onOpenCardPath && <VaultCardBacklinks key={itemId} itemId={itemId} onOpen={onOpenCardPath} />}
    {linkError && <p role="alert">{linkError}</p>}
    {document.content.tags.length > 0 && <div className="vault-note-display-tags">{document.content.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
  </section>;
}
