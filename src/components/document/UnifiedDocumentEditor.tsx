"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  UIEvent,
} from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { Blog, Post } from "@/lib/content";
import { CollabProvider, type PresencePeer } from "@/lib/collab/provider";
import {
  applyDocumentBaseline,
  applyDocumentSnapshot,
  documentSnapshotFromYDoc,
  documentText,
  hasDocumentSnapshot,
} from "@/lib/collab/document";
import {
  requireDocumentSnapshot,
  type DocumentSnapshot,
} from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { DocumentRenderer } from "./DocumentRenderer";
import { TemplateGallery } from "./TemplateGallery";

export type UnifiedEditorCollab = {
  postId: string;
  userName: string;
  color: string;
  canEdit: boolean;
};

type SaveState = "local" | "saving" | "saved" | "offline" | "error";
type EditableField = "title" | "subtitle" | "body";

type RemoteSelection = {
  clientId: number;
  userName: string;
  color: string;
  field: EditableField;
  from: number;
  to: number;
};

type RelativeSelectionState = {
  field: EditableField;
  anchor: string;
  head: string;
};

export type UnifiedDocumentEditorProps = {
  active?: boolean;
  blog: Blog;
  post: Post;
  template: TemplateDefinition;
  availableTemplates?: readonly TemplateDefinition[];
  collab: UnifiedEditorCollab;
  onDocumentChange?: (document: DocumentSnapshot) => void;
  onMaterialized?: (document: DocumentSnapshot, revision?: number) => void;
  onDone: () => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onChooseTemplate?: () => void;
  leadingControls?: ReactNode;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function replaceYText(target: Y.Text, value: string, origin: unknown): void {
  const current = target.toString();
  if (current === value) return;
  let prefix = 0;
  const sharedLength = Math.min(current.length, value.length);
  while (prefix < sharedLength && current[prefix] === value[prefix]) prefix += 1;
  let currentSuffix = current.length;
  let valueSuffix = value.length;
  while (
    currentSuffix > prefix &&
    valueSuffix > prefix &&
    current[currentSuffix - 1] === value[valueSuffix - 1]
  ) {
    currentSuffix -= 1;
    valueSuffix -= 1;
  }
  target.doc?.transact(() => {
    if (currentSuffix > prefix) target.delete(prefix, currentSuffix - prefix);
    if (valueSuffix > prefix) target.insert(prefix, value.slice(prefix, valueSuffix));
  }, origin);
}

function publishedDate(post: Post): string | undefined {
  const value = post.date ?? post.createdAt;
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return undefined;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function selectionForField(
  awareness: Awareness,
  doc: Y.Doc,
  field: EditableField,
): RemoteSelection[] {
  const selections: RemoteSelection[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID || !state) continue;
    const selection = state.selection as RelativeSelectionState | undefined;
    if (!selection || selection.field !== field) continue;
    const user = state.user as
      | { name?: unknown; color?: unknown; clientId?: unknown }
      | undefined;
    try {
      const anchor = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(base64ToBytes(selection.anchor)),
        doc,
      );
      const head = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(base64ToBytes(selection.head)),
        doc,
      );
      if (!anchor || !head || anchor.type !== head.type) continue;
      selections.push({
        clientId,
        userName:
          typeof user?.name === "string" && user.name.trim()
            ? user.name.trim()
            : "Someone",
        color:
          typeof user?.color === "string" ? user.color : "#0071e3",
        field,
        from: Math.min(anchor.index, head.index),
        to: Math.max(anchor.index, head.index),
      });
    } catch {
      // Awareness is ephemeral. Ignore a malformed remote selection.
    }
  }
  return selections;
}

function SelectionMirror({
  value,
  selections,
}: {
  value: string;
  selections: RemoteSelection[];
}) {
  const boundaries = new Set<number>([0, value.length]);
  for (const selection of selections) {
    boundaries.add(Math.max(0, Math.min(value.length, selection.from)));
    boundaries.add(Math.max(0, Math.min(value.length, selection.to)));
  }
  const points = Array.from(boundaries).sort((left, right) => left - right);
  const output: ReactNode[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    for (const selection of selections.filter(
      (candidate) => candidate.from === candidate.to && candidate.from === start,
    )) {
      output.push(
        <span
          className="tt-remote-caret"
          key={`caret-${selection.clientId}-${start}`}
          style={{ "--tt-peer": selection.color } as CSSProperties}
        >
          <span>{selection.userName}</span>
        </span>,
      );
    }
    const end = points[index + 1];
    if (end === undefined || end <= start) continue;
    const active = selections.find(
      (selection) => selection.from < end && selection.to > start,
    );
    const text = value.slice(start, end);
    output.push(
      active ? (
        <mark
          key={`selection-${start}-${end}`}
          style={{ "--tt-peer": active.color } as CSSProperties}
        >
          {text}
        </mark>
      ) : (
        <span key={`text-${start}-${end}`}>{text}</span>
      ),
    );
  }
  output.push(<span key="trailing-line">{"\n"}</span>);
  return <>{output}</>;
}

function CollaborativeTextarea({
  field,
  label,
  value,
  placeholder,
  selections,
  onChange,
  onSelection,
  inputRef,
  rows = 1,
  grow = false,
}: {
  field: EditableField;
  label: string;
  value: string;
  placeholder: string;
  selections: RemoteSelection[];
  onChange: (value: string) => void;
  onSelection: (field: EditableField, anchor: number, head: number) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  rows?: number;
  grow?: boolean;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLPreElement>(null);
  const ref = inputRef ?? localRef;

  useLayoutEffect(() => {
    if (!grow || !ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.max(ref.current.scrollHeight, 40)}px`;
  }, [grow, ref, value]);

  const reportSelection = useCallback(() => {
    const control = ref.current;
    if (!control) return;
    onSelection(field, control.selectionStart, control.selectionEnd);
  }, [field, onSelection, ref]);

  const syncScroll = useCallback(
    (event: UIEvent<HTMLTextAreaElement>) => {
      if (!mirrorRef.current) return;
      mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
      mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft;
    },
    [],
  );

  return (
    <div className={`tt-collaborative-field tt-field-${field}`}>
      <pre ref={mirrorRef} className="tt-collaborative-mirror" aria-hidden="true">
        <SelectionMirror value={value} selections={selections} />
      </pre>
      <textarea
        ref={ref}
        aria-label={label}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
          onChange(event.currentTarget.value)
        }
        onInput={reportSelection}
        onKeyUp={reportSelection}
        onMouseUp={reportSelection}
        onSelect={reportSelection}
        onScroll={syncScroll}
        onBlur={() => onSelection(field, -1, -1)}
      />
    </div>
  );
}

function Presence({ peers }: { peers: PresencePeer[] }) {
  if (peers.length === 0) return null;
  return (
    <div className="tt-unified-presence" aria-label="People in this document">
      {peers.slice(0, 5).map((peer) => (
        <span
          key={peer.clientId}
          style={{ backgroundColor: peer.color }}
          title={peer.userName}
        >
          {peer.userName.trim().slice(0, 1).toUpperCase() || "?"}
        </span>
      ))}
    </div>
  );
}

export function UnifiedDocumentEditor({
  active = true,
  blog,
  post,
  template,
  availableTemplates,
  collab,
  onDocumentChange,
  onMaterialized,
  onDone,
  onDelete,
  onChooseTemplate,
  leadingControls,
}: UnifiedDocumentEditorProps) {
  const initialDocument = useMemo(
    () =>
      requireDocumentSnapshot(
        post.document,
        `Item ${post.id ?? post.slug}`,
      ),
    [post],
  );
  const initialDocumentRef = useRef(initialDocument);
  const [document, setDocument] = useState(initialDocument);
  const documentRef = useRef(document);
  const [doc] = useState(() => new Y.Doc());
  const [awareness] = useState(() => new Awareness(doc));
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [remoteRevision, setRemoteRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("local");
  const [error, setError] = useState<string | null>(null);
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const providerRef = useRef<CollabProvider | null>(null);
  const materializeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const materializeQueueRef = useRef(Promise.resolve());
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const subtitleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const localOrigin = useRef(Symbol("unified-document-editor"));
  const networkEnabled = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    collab.postId,
  );

  const publishDocument = useCallback(
    (next: DocumentSnapshot) => {
      documentRef.current = next;
      setDocument(next);
      onDocumentChange?.(next);
    },
    [onDocumentChange],
  );

  const updateDocumentSnapshot = useCallback(
    (next: DocumentSnapshot) => {
      publishDocument(next);
      if (!hasDocumentSnapshot(doc) && (!networkEnabled || ready)) {
        applyDocumentSnapshot(doc, next, localOrigin.current);
      } else if (hasDocumentSnapshot(doc)) {
        applyDocumentSnapshot(doc, next, localOrigin.current);
      }
      if (!ready || !networkEnabled) setSaveState("local");
    },
    [doc, networkEnabled, publishDocument, ready],
  );

  const activeTemplate = useMemo(() => {
    const reference = document.presentation.template;
    return (
      availableTemplates?.find(
        (candidate) =>
          candidate.id === reference.id && candidate.version === reference.version,
      ) ?? template
    );
  }, [availableTemplates, document.presentation.template, template]);

  const flushMaterialization = useCallback(
    (keepalive = false) => {
      if (!networkEnabled || !collab.canEdit || !hasDocumentSnapshot(doc)) {
        setSaveState("local");
        return Promise.resolve();
      }
      if (materializeTimerRef.current) {
        clearTimeout(materializeTimerRef.current);
        materializeTimerRef.current = null;
      }
      const state = bytesToBase64(Y.encodeStateAsUpdate(doc));
      setSaveState("saving");
      const request = materializeQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const response = await fetch(
            `/api/collab/${encodeURIComponent(collab.postId)}/materialize`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ handle: blog.handle, state }),
              keepalive,
            },
          );
          if (!response.ok) throw new Error("Document could not be saved");
          const result = (await response.json()) as {
            document?: DocumentSnapshot;
            revision?: number;
          };
          if (result.document) {
            onMaterialized?.(result.document, result.revision);
          }
          setSaveState("saved");
          setError(null);
        })
        .catch((cause) => {
          setSaveState(navigator.onLine ? "error" : "offline");
          setError(cause instanceof Error ? cause.message : "Document could not be saved");
        });
      materializeQueueRef.current = request;
      return request;
    },
    [
      blog.handle,
      collab.canEdit,
      collab.postId,
      doc,
      networkEnabled,
      onMaterialized,
    ],
  );

  const scheduleMaterialization = useCallback(() => {
    if (!networkEnabled || !collab.canEdit) return;
    setSaveState("local");
    if (materializeTimerRef.current) clearTimeout(materializeTimerRef.current);
    materializeTimerRef.current = setTimeout(() => {
      materializeTimerRef.current = null;
      void flushMaterialization();
    }, 500);
  }, [collab.canEdit, flushMaterialization, networkEnabled]);

  useEffect(() => {
    if (!networkEnabled) {
      if (!hasDocumentSnapshot(doc)) {
        applyDocumentSnapshot(doc, initialDocumentRef.current, localOrigin.current);
      }
      publishDocument(documentSnapshotFromYDoc(doc));
      setReady(true);
      setSaveState("local");
      return;
    }

    let cancelled = false;
    const provider = new CollabProvider(doc, {
      ...collab,
      awareness,
      canPush: collab.canEdit,
      onPresence: setPeers,
      onError: (message) => {
        if (!cancelled) {
          setError(message);
          setSaveState(navigator.onLine ? "error" : "offline");
        }
      },
      expectedBaselineRevision: post.revision ?? 0,
      onBaselineMismatch: () => {
        if (!cancelled) {
          setError("This document changed elsewhere. Local edits were kept for recovery.");
          setSaveState("error");
        }
      },
      onRetired: () => {
        if (!cancelled) {
          setError("This document changed on another device. Reconnecting.");
          setSaveState("offline");
        }
      },
    });
    providerRef.current = provider;

    const handleDocumentUpdate = () => {
      if (!hasDocumentSnapshot(doc)) return;
      try {
        const next = documentSnapshotFromYDoc(doc);
        publishDocument(next);
        scheduleMaterialization();
      } catch {
        setError("This document contains unsupported data.");
      }
    };
    doc.on("update", handleDocumentUpdate);

    void provider.start().then((result) => {
      if (cancelled) return;
      const localBeforeReady = documentRef.current;
      if (!hasDocumentSnapshot(doc)) {
        applyDocumentBaseline(
          doc,
          initialDocumentRef.current,
          `${collab.postId}:${post.revision ?? 0}`,
          localOrigin.current,
        );
      }
      let remote = documentSnapshotFromYDoc(doc);
      const initial = initialDocumentRef.current;
      const textChanges: EditableField[] = ["title", "subtitle", "body"];
      for (const field of textChanges) {
        const initialValue = initial.content[field] ?? "";
        const localValue = localBeforeReady.content[field] ?? "";
        if (localValue !== initialValue) {
          replaceYText(documentText(doc, field), localValue, localOrigin.current);
        }
      }
      if (
        JSON.stringify(localBeforeReady.content.fields) !==
          JSON.stringify(initial.content.fields) ||
        JSON.stringify(localBeforeReady.content.assets) !==
          JSON.stringify(initial.content.assets) ||
        JSON.stringify(localBeforeReady.content.tags) !==
          JSON.stringify(initial.content.tags) ||
        JSON.stringify(localBeforeReady.presentation) !==
          JSON.stringify(initial.presentation)
      ) {
        remote = {
          ...remote,
          content: {
            ...remote.content,
            fields: localBeforeReady.content.fields,
            assets: localBeforeReady.content.assets,
            tags: localBeforeReady.content.tags,
          },
          presentation: localBeforeReady.presentation,
        };
        applyDocumentSnapshot(doc, remote, localOrigin.current);
      }
      publishDocument(documentSnapshotFromYDoc(doc));
      setReady(true);
      if (!result.authoritative) setSaveState("offline");
    });

    const handleAwareness = () => setRemoteRevision((value) => value + 1);
    awareness.on("change", handleAwareness);

    const handlePageHide = () => {
      void flushMaterialization(true);
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", handlePageHide);
      awareness.off("change", handleAwareness);
      doc.off("update", handleDocumentUpdate);
      if (materializeTimerRef.current) clearTimeout(materializeTimerRef.current);
      void flushMaterialization(true);
      provider.destroy();
      providerRef.current = null;
    };
  }, [
    awareness,
    collab.canEdit,
    collab.color,
    collab.postId,
    collab.userName,
    doc,
    flushMaterialization,
    networkEnabled,
    post.revision,
    publishDocument,
    scheduleMaterialization,
  ]);

  const updateText = useCallback(
    (field: EditableField, value: string) => {
      const normalized = field === "title" ? value.replace(/[\r\n]+/g, " ") : value;
      const next: DocumentSnapshot = {
        ...documentRef.current,
        content: {
          ...documentRef.current.content,
          [field]: normalized || (field === "subtitle" ? undefined : ""),
        },
      };
      publishDocument(next);
      if (!hasDocumentSnapshot(doc) && (!networkEnabled || ready)) {
        applyDocumentSnapshot(doc, documentRef.current, localOrigin.current);
      }
      if (!hasDocumentSnapshot(doc)) {
        setSaveState("local");
        return;
      }
      replaceYText(documentText(doc, field), normalized, localOrigin.current);
      if (!ready || !networkEnabled) setSaveState("local");
    },
    [doc, networkEnabled, publishDocument, ready],
  );

  const updateSelection = useCallback(
    (field: EditableField, anchor: number, head: number) => {
      if (!ready || anchor < 0 || head < 0) {
        awareness.setLocalStateField("selection", null);
        return;
      }
      const target = documentText(doc, field);
      const selection: RelativeSelectionState = {
        field,
        anchor: bytesToBase64(
          Y.encodeRelativePosition(
            Y.createRelativePositionFromTypeIndex(target, anchor),
          ),
        ),
        head: bytesToBase64(
          Y.encodeRelativePosition(
            Y.createRelativePositionFromTypeIndex(target, head),
          ),
        ),
      };
      awareness.setLocalStateField("selection", selection);
    },
    [awareness, doc, ready],
  );

  const remoteSelections = useMemo(
    () => ({
      title: selectionForField(awareness, doc, "title"),
      subtitle: selectionForField(awareness, doc, "subtitle"),
      body: selectionForField(awareness, doc, "body"),
    }),
    [awareness, doc, remoteRevision],
  );

  const stopEditing = useCallback(async () => {
    await flushMaterialization();
    await onDone();
  }, [flushMaterialization, onDone]);

  const handleKeyboard = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void stopEditing();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void stopEditing();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushMaterialization();
      }
    },
    [flushMaterialization, stopEditing],
  );

  const slots = useMemo(
    () => ({
      bindings: {
        "content.title": (
          <CollaborativeTextarea
            field="title"
            label="Title"
            placeholder="Untitled"
            value={document.content.title}
            selections={remoteSelections.title}
            onChange={(value) => updateText("title", value)}
            onSelection={updateSelection}
            inputRef={titleRef}
            grow
          />
        ),
        "content.subtitle": (
          <CollaborativeTextarea
            field="subtitle"
            label="Subtitle"
            placeholder="Add a short description"
            value={document.content.subtitle ?? ""}
            selections={remoteSelections.subtitle}
            onChange={(value) => updateText("subtitle", value)}
            onSelection={updateSelection}
            inputRef={subtitleRef}
            grow
          />
        ),
        "content.body": (
          <CollaborativeTextarea
            field="body"
            label="Document body"
            placeholder="Start writing"
            value={document.content.body}
            selections={remoteSelections.body}
            onChange={(value) => updateText("body", value)}
            onSelection={updateSelection}
            inputRef={bodyRef}
            rows={18}
          />
        ),
      },
    }),
    [document.content.body, document.content.subtitle, document.content.title, remoteSelections, updateSelection, updateText],
  );

  if (!active) return null;
  return (
    <section className="tt-unified-editor" onKeyDown={handleKeyboard}>
      {choosingTemplate && availableTemplates && availableTemplates.length > 0 && (
        <TemplateGallery
          document={document}
          templates={availableTemplates}
          onClose={() => setChoosingTemplate(false)}
          onApply={(selected) => {
            updateDocumentSnapshot({
              ...documentRef.current,
              presentation: {
                ...documentRef.current.presentation,
                template: { id: selected.id, version: selected.version },
              },
            });
            setChoosingTemplate(false);
          }}
        />
      )}
      <div className="post-top-action-bar applecms is-edit" aria-label="Document controls">
        <div className="post-action-toolbar ac-chrome">
          {leadingControls}
          <Presence peers={peers} />
          {(onChooseTemplate || (availableTemplates && availableTemplates.length > 0)) && (
            <button
              type="button"
              className="ac-btn ac-btn-gray"
              onClick={() => {
                if (availableTemplates?.length) setChoosingTemplate(true);
                else onChooseTemplate?.();
              }}
            >
              {activeTemplate.name}
            </button>
          )}
          {onDelete && (
            <button type="button" className="ac-btn ac-btn-gray" onClick={() => void onDelete()}>
              Delete
            </button>
          )}
          <button type="button" className="ac-btn ac-btn-blue" onClick={() => void stopEditing()}>
            Stop editing
          </button>
        </div>
      </div>
      <DocumentRenderer
        document={document}
        documentId={post.id ?? post.slug}
        template={activeTemplate}
        metadata={{
          author: blog.author,
          date: publishedDate(post),
          readingTime: post.readingTime ? `${post.readingTime} min read` : undefined,
        }}
        slots={slots}
        className="tt-document-editor"
      />
      <div className={`tt-save-state is-${saveState}`} role="status" aria-live="polite">
        {saveState === "local" && !networkEnabled
          ? "Saved on this device"
          : saveState === "offline"
          ? "Saved on this device"
          : saveState === "error"
            ? error ?? "Could not sync"
            : saveState === "saving"
              ? "Saving"
              : ""}
      </div>
      <style>{`
        .tt-unified-editor{min-height:100%;background:var(--paper,#fff)}
        .tt-document-editor{min-height:100vh;padding-bottom:5rem}
        .tt-document-editor .tt-collaborative-field{position:relative;width:100%;min-width:0}
        .tt-document-editor .tt-collaborative-field textarea,.tt-document-editor .tt-collaborative-mirror{box-sizing:border-box;width:100%;margin:0;padding:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;line-height:inherit;letter-spacing:0;white-space:pre-wrap;overflow-wrap:anywhere;resize:none;text-align:inherit}
        .tt-document-editor .tt-collaborative-field textarea{position:relative;z-index:2;display:block;caret-color:var(--tt-accent);overflow:auto}
        .tt-document-editor .tt-collaborative-mirror{position:absolute;z-index:1;inset:0;pointer-events:none;overflow:hidden;color:transparent}
        .tt-document-editor .tt-collaborative-mirror mark{background:color-mix(in srgb,var(--tt-peer) 28%,transparent);color:transparent;border-radius:2px}
        .tt-document-editor .tt-remote-caret{position:relative;border-inline-start:2px solid var(--tt-peer);margin-inline-start:-1px;color:transparent}
        .tt-document-editor .tt-remote-caret>span{position:absolute;left:-2px;bottom:100%;padding:2px 5px;background:var(--tt-peer);color:#fff;font:600 10px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;white-space:nowrap;border-radius:3px}
        .tt-document-editor .tt-field-body textarea,.tt-document-editor .tt-field-body .tt-collaborative-mirror{min-height:48vh;text-align:start}
        .tt-document-editor .tt-field-body textarea{resize:vertical}
        .tt-unified-presence{display:flex;align-items:center;padding-inline:3px}
        .tt-unified-presence span{display:grid;place-items:center;width:25px;height:25px;margin-inline-start:-5px;border:2px solid var(--ac-material,#fff);border-radius:50%;color:#fff;font-size:10px;font-weight:700}
        .tt-save-state{position:fixed;right:12px;bottom:12px;z-index:220;min-height:1rem;padding:5px 8px;border-radius:6px;background:color-mix(in srgb,var(--paper,#fff) 90%,transparent);color:var(--muted,#6e6e73);font-size:12px;pointer-events:none}
        .tt-save-state:empty{display:none}.tt-save-state.is-error{color:#b42318}
        @media(prefers-color-scheme:dark){.tt-unified-editor{--paper:#1c1c1e;--ink:#f5f5f7;--muted:#a1a1a6}}
        @media(prefers-reduced-motion:reduce){.tt-unified-editor *{transition:none!important;animation:none!important}}
      `}</style>
    </section>
  );
}
