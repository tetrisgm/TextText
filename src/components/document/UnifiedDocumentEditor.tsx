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
import { CollaboratorMark } from "@/components/collab/CollaboratorMark";
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
import { MarkdownSurface } from "./MarkdownSurface";
import { TemplateGallery } from "./TemplateGallery";
import { FieldInput, collectBoundFields } from "./FieldInput";
import type { DocumentFieldValue } from "@/lib/documents/model";

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

/**
 * Overlay pre-ready local edits onto the authoritative remote baseline.
 *
 * Pure and exported so the regression for the clobber sequence is testable
 * without React: a remote update arriving while the provider started used to
 * overwrite the only copy of a just-typed edit, and this merge then compared
 * the clobbered state against `initial` and concluded there was nothing to
 * keep. The caller now hands this function the pre-ready LEDGER, which remote
 * updates never touch. Returns null when local made no changes worth keeping.
 */
export function overlayPreReadyEdits(
  localBeforeReady: DocumentSnapshot,
  initial: DocumentSnapshot,
  remote: DocumentSnapshot,
): DocumentSnapshot | null {
  const changed =
    JSON.stringify(localBeforeReady.content.fields) !==
      JSON.stringify(initial.content.fields) ||
    JSON.stringify(localBeforeReady.content.assets) !==
      JSON.stringify(initial.content.assets) ||
    JSON.stringify(localBeforeReady.content.tags) !==
      JSON.stringify(initial.content.tags) ||
    JSON.stringify(localBeforeReady.presentation) !==
      JSON.stringify(initial.presentation);
  if (!changed) return null;
  return {
    ...remote,
    content: {
      ...remote.content,
      fields: localBeforeReady.content.fields,
      assets: localBeforeReady.content.assets,
      tags: localBeforeReady.content.tags,
    },
    presentation: localBeforeReady.presentation,
  };
}

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

function selectionForField(
  awareness: Awareness,
  doc: Y.Doc,
  field: EditableField,
  peers: readonly PresencePeer[] = [],
): RemoteSelection[] {
  const bySessionId = new Map(peers.map((peer) => [peer.clientId, peer]));
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
      // The stable session id inside the blob is the same key the presence
      // sweep prunes on, so it is what ties a caret to its server-resolved row.
      const peer =
        typeof user?.clientId === "string"
          ? bySessionId.get(user.clientId)
          : undefined;
      selections.push({
        clientId,
        userName:
          peer?.userName?.trim() ||
          (typeof user?.name === "string" && user.name.trim()
            ? user.name.trim()
            : "Someone"),
        color:
          peer?.color ||
          (typeof user?.color === "string" ? user.color : "#0071e3"),
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
    <div className="tt-unified-presence" aria-label="Collaborators in this document">
      {peers.slice(0, 5).map((peer) => (
        peer.participantType === "agent" ? (
          <span
            key={peer.clientId}
            className="tt-agent-presence"
            title={`${peer.userName} is collaborating through MCP`}
          >
            <span
              className="tt-agent-avatar"
              style={{ backgroundColor: peer.color }}
            >
              <CollaboratorMark provider={peer.provider} name={peer.userName} />
            </span>
            <span className="tt-agent-name">{peer.userName}</span>
          </span>
        ) : (
          <span
            key={peer.clientId}
            className="tt-person-presence"
            style={{ backgroundColor: peer.color }}
            title={peer.userName}
          >
            {peer.userName.trim().slice(0, 1).toUpperCase() || "?"}
          </span>
        )
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
  /**
   * Local edits made BEFORE the provider is ready, kept where an incoming
   * remote update cannot clobber them. documentRef mirrors whatever was
   * published last, INCLUDING remote snapshots pulled while the provider is
   * still starting; a user who types during that window would have their edit
   * exist only in documentRef until the doc accepts writes, so one remote
   * baseline arriving first silently erased it. The ready-merge reads this
   * ledger, applies it over the authoritative baseline, then clears it.
   */
  const preReadyLocalRef = useRef<DocumentSnapshot | null>(null);
  /** The newest LOCAL state: the pre-ready ledger when it exists, else the
   * last published snapshot. Every local edit builds on this. */
  const currentLocalDocument = useCallback(
    () => preReadyLocalRef.current ?? documentRef.current,
    [],
  );
  const [doc] = useState(() => new Y.Doc());
  const [awareness] = useState(() => new Awareness(doc));
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [remoteRevision, setRemoteRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("local");
  const [error, setError] = useState<string | null>(null);
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const canAddSubtitle =
    !showSubtitle && !document.content.subtitle?.trim();
  const providerRef = useRef<CollabProvider | null>(null);
  const materializeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const materializeQueueRef = useRef(Promise.resolve());
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const subtitleRef = useRef<HTMLTextAreaElement>(null);
  const bodySurfaceRef = useRef<HTMLDivElement>(null);
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
        if (ready) preReadyLocalRef.current = null;
      } else {
        // The doc did not accept this edit yet; ledger it so a remote update
        // arriving before ready cannot erase it.
        preReadyLocalRef.current = next;
      }
      if (!ready || !networkEnabled) setSaveState("local");
    },
    [doc, networkEnabled, publishDocument, ready],
  );

  const updateField = useCallback(
    (fieldId: string, value: DocumentFieldValue) => {
      const current = currentLocalDocument();
      updateDocumentSnapshot({
        ...current,
        content: {
          ...current.content,
          fields: { ...current.content.fields, [fieldId]: value },
        },
      });
    },
    [currentLocalDocument, updateDocumentSnapshot],
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
      // The ledger, never documentRef: a remote update that arrived while the
      // provider was starting has already overwritten documentRef.
      const localBeforeReady = preReadyLocalRef.current ?? documentRef.current;
      preReadyLocalRef.current = null;
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
      const overlaid = overlayPreReadyEdits(localBeforeReady, initial, remote);
      if (overlaid) {
        remote = overlaid;
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
      const base = currentLocalDocument();
      const next: DocumentSnapshot = {
        ...base,
        content: {
          ...base.content,
          [field]: normalized || (field === "subtitle" ? undefined : ""),
        },
      };
      publishDocument(next);
      if (!hasDocumentSnapshot(doc) && (!networkEnabled || ready)) {
        applyDocumentSnapshot(doc, next, localOrigin.current);
      }
      if (!hasDocumentSnapshot(doc)) {
        preReadyLocalRef.current = next;
        setSaveState("local");
        return;
      }
      replaceYText(documentText(doc, field), normalized, localOrigin.current);
      if (!ready || !networkEnabled) setSaveState("local");
    },
    [currentLocalDocument, doc, networkEnabled, publishDocument, ready],
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
      title: selectionForField(awareness, doc, "title", peers),
      subtitle: selectionForField(awareness, doc, "subtitle", peers),
      body: selectionForField(awareness, doc, "body", peers),
    }),
    [awareness, doc, peers, remoteRevision],
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
        ...(showSubtitle || document.content.subtitle?.trim()
          ? {
              "content.subtitle": (
                <CollaborativeTextarea
                  field="subtitle"
                  label="Description"
                  placeholder="Add a description"
                  value={document.content.subtitle ?? ""}
                  selections={remoteSelections.subtitle}
                  onChange={(value) => updateText("subtitle", value)}
                  onSelection={updateSelection}
                  inputRef={subtitleRef}
                  grow
                />
              ),
            }
          : {}),
        "content.body": (
          <div className="tt-collaborative-field tt-field-body">
            <MarkdownSurface
              label="Document body"
              placeholder="Start writing"
              value={document.content.body}
              selections={remoteSelections.body}
              onChange={(value) => updateText("body", value)}
              onSelection={(anchor, head) =>
                updateSelection("body", anchor, head)
              }
              surfaceRef={bodySurfaceRef}
            />
          </div>
        ),
        ...Object.fromEntries(
          activeTemplate.fields.map((field) => [
            `content.fields.${field.id}`,
            <FieldInput
              key={field.id}
              field={field}
              value={document.content.fields[field.id]}
              onChange={(value) => updateField(field.id, value)}
              embedded
            />,
          ]),
        ),
      },
    }),
    [activeTemplate.fields, document.content.body, document.content.fields, document.content.subtitle, document.content.title, remoteSelections, showSubtitle, updateField, updateSelection, updateText],
  );

  /** Declared fields the template does not bind anywhere in its item spec.
   * They still need an input, or a declared field is writable only by agents. */
  const unboundFields = useMemo(() => {
    const bound = collectBoundFields(activeTemplate.item);
    return activeTemplate.fields.filter((field) => !bound.has(field.id));
  }, [activeTemplate]);

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
              ...currentLocalDocument(),
              presentation: {
                ...currentLocalDocument().presentation,
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
              className="ac-btn ac-btn-gray tt-look-button"
              onClick={() => {
                if (availableTemplates?.length) setChoosingTemplate(true);
                else onChooseTemplate?.();
              }}
            >
              <span>Look</span>
              <span className="tt-look-name">{activeTemplate.name}</span>
            </button>
          )}
          {(canAddSubtitle || onDelete) && (
            <details className="tt-editor-more">
            <summary aria-label="More actions" title="More actions">
              <span aria-hidden="true">•••</span>
            </summary>
            <div className="tt-editor-more-menu">
              {canAddSubtitle && (
                <button
                  type="button"
                  onClick={() => {
                    setShowSubtitle(true);
                    window.requestAnimationFrame(() =>
                      subtitleRef.current?.focus(),
                    );
                  }}
                >
                  Add a description
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  className="tt-editor-more-destructive"
                  onClick={() => void onDelete()}
                >
                  Move to Trash
                </button>
              )}
            </div>
          </details>
          )}
          <button type="button" className="ac-btn ac-btn-gray" onClick={() => void stopEditing()}>
            Stop editing
          </button>
        </div>
      </div>
      {/* No byline while writing: the author, reading time, and date are
          reader chrome, and showing them here turns the page into a preview
          of itself instead of the thing being written. */}
      <DocumentRenderer
        document={document}
        documentId={post.id ?? post.slug}
        template={activeTemplate}
        slots={slots}
        className="tt-document-editor"
      />
      {unboundFields.length > 0 && (
        // Fields the look declares but does not place stay one level down, so
        // the writing surface is a document rather than a form.
        <details className="tt-field-details">
          <summary className="tt-field-details-title">
            Details
            <span className="tt-field-details-count" aria-hidden="true">
              {unboundFields.length}
            </span>
          </summary>
          <div className="tt-field-details-body">
            {unboundFields.map((field) => (
              <FieldInput
                key={field.id}
                field={field}
                value={document.content.fields[field.id]}
                onChange={(value) => updateField(field.id, value)}
              />
            ))}
          </div>
        </details>
      )}
      <div className={`tt-save-state is-${saveState}`} role="status" aria-live="polite">
        {saveState === "local" && !networkEnabled
          ? "Saved on this device"
          : saveState === "offline"
          ? "Saved on this device"
          : saveState === "error"
            ? error ?? "Could not sync"
            : saveState === "saving"
              ? "Saving"
              : saveState === "saved"
                ? "Saved"
                : ""}
      </div>
      <style>{`
        .tt-unified-editor{min-height:100%;background:var(--paper,#fff)}
        .tt-document-editor{min-height:100vh;padding-bottom:3rem}
        @media(max-width:700px){.tt-document-editor{padding-top:56px}.tt-look-name{display:none}}
        .tt-document-editor .tt-collaborative-field{position:relative;width:100%;min-width:0}
        .tt-document-editor .tt-collaborative-field textarea,.tt-document-editor .tt-collaborative-mirror{box-sizing:border-box;width:100%;margin:0;padding:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;line-height:inherit;letter-spacing:0;white-space:pre-wrap;overflow-wrap:anywhere;resize:none;text-align:inherit}
        .tt-document-editor .tt-collaborative-field textarea{position:relative;z-index:2;display:block;caret-color:var(--tt-accent);overflow:auto}.tt-document-editor .tt-collaborative-field:focus-within{position:relative}.tt-document-editor .tt-collaborative-field:focus-within::before{content:"";position:absolute;z-index:0;inset:-6px -10px;border-radius:6px;background:color-mix(in srgb,var(--tt-accent,#0071e3) 7%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--tt-accent,#0071e3) 26%,transparent);pointer-events:none}@media(forced-colors:active){.tt-document-editor .tt-collaborative-field:focus-within::before{box-shadow:inset 0 0 0 2px Highlight}}
        .tt-document-editor .tt-collaborative-mirror{position:absolute;z-index:1;inset:0;pointer-events:none;overflow:hidden;color:transparent}
        .tt-document-editor .tt-collaborative-mirror mark{background:color-mix(in srgb,var(--tt-peer) 28%,transparent);color:transparent;border-radius:2px}
        .tt-document-editor .tt-remote-caret{position:relative;border-inline-start:2px solid var(--tt-peer);margin-inline-start:-1px;color:transparent}
        .tt-document-editor .tt-remote-caret>span{position:absolute;left:-2px;bottom:100%;padding:2px 5px;background:var(--tt-peer);color:#fff;font:600 10px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;white-space:nowrap;border-radius:3px}
        .tt-document-editor .tt-field-body textarea,.tt-document-editor .tt-field-body .tt-collaborative-mirror{min-height:36vh;text-align:start}
        /* The writing surface renders the source itself, styled, so what you
           type looks like what a reader gets without the document stopping
           being Markdown. */
        .tt-md-surface{min-height:36vh;outline:0;white-space:pre-wrap;overflow-wrap:anywhere;text-align:start;caret-color:var(--tt-accent,#0071e3)}
        .tt-md-surface[data-empty="true"]::before{content:attr(data-placeholder);color:var(--muted,#6e6e73);pointer-events:none}
        .tt-md-marker{color:color-mix(in srgb,currentColor 32%,transparent);font-weight:400}
        .tt-md-strong{font-weight:700}
        .tt-md-em{font-style:italic}
        .tt-md-code{font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:.94em}
        .tt-md-h1{font-size:1.85em;font-weight:700;line-height:1.2}
        .tt-md-h2{font-size:1.45em;font-weight:700;line-height:1.25}
        .tt-md-h3{font-size:1.2em;font-weight:700;line-height:1.3}
        .tt-md-h4{font-size:1.05em;font-weight:700}
        .tt-md-quote{color:color-mix(in srgb,currentColor 76%,transparent);font-style:italic}
        .tt-md-peer{background:color-mix(in srgb,var(--tt-peer) 26%,transparent);border-radius:2px}
        .tt-md-remote-caret{display:inline;position:relative;pointer-events:none;user-select:none}
        .tt-md-remote-caret::after{content:attr(data-name);position:absolute;left:-2px;bottom:100%;padding:2px 5px;background:var(--tt-peer);color:#fff;font:600 10px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;white-space:nowrap;border-radius:3px}
        @media(forced-colors:active){.tt-md-marker{color:GrayText}}
        .tt-document-editor .tt-field-body textarea{resize:none}
        .tt-unified-presence{display:flex;align-items:center;gap:4px;padding-inline:3px}
        .tt-person-presence,.tt-agent-avatar{display:grid;place-items:center;width:25px;height:25px;border:2px solid var(--ac-material,#fff);border-radius:50%;color:#fff;font-size:10px;font-weight:700}
        .tt-person-presence+.tt-person-presence{margin-inline-start:-9px}
        .tt-agent-presence{display:inline-flex;align-items:center;max-width:132px;min-width:0;padding:2px 8px 2px 2px;gap:5px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:999px;background:var(--ac-fill-4,rgba(118,118,128,.08));color:var(--ink,#1d1d1f);font-size:11px;font-weight:600}
        .tt-agent-avatar{flex:0 0 auto;border-style:double;border-width:3px}
        .tt-agent-avatar>span{display:contents}
        .tt-agent-avatar svg{width:13px;height:13px;fill:currentColor}
        .tt-agent-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .tt-save-state{position:fixed;right:12px;bottom:12px;z-index:220;min-height:1rem;padding:5px 9px;border:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 12%,transparent);border-radius:6px;background:var(--paper,#fff);color:var(--muted,#6e6e73);font-size:12px;pointer-events:none}
        .tt-save-state:empty{display:none}.tt-save-state.is-error{color:#b42318}@media(prefers-color-scheme:dark){.tt-save-state.is-error{color:#ff8a80}}
        .tt-look-button{display:inline-flex;align-items:center;gap:5px}.tt-look-name{max-width:9rem;overflow:hidden;color:var(--muted,#6e6e73);font-weight:500;text-overflow:ellipsis;white-space:nowrap}
        .tt-editor-more{position:relative}.tt-editor-more>summary{display:grid;place-items:center;box-sizing:border-box;min-width:30px;height:30px;padding:0 8px;border:0;border-radius:6px;background:var(--ac-fill-4,rgba(118,118,128,.12));color:var(--ink,#1d1d1f);font:700 11px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;letter-spacing:1px;cursor:pointer;list-style:none}.tt-editor-more>summary::-webkit-details-marker{display:none}.tt-editor-more[open]>summary{background:var(--ac-fill-3,rgba(118,118,128,.2))}
        .tt-editor-more-menu{position:absolute;z-index:420;top:calc(100% + 6px);right:0;min-width:160px;padding:5px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:8px;background:color-mix(in srgb,var(--paper,#fff) 94%,transparent);box-shadow:0 12px 32px rgba(0,0,0,.16);backdrop-filter:blur(24px) saturate(150%)}.tt-editor-more-menu button{width:100%;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:var(--ink,#1d1d1f);font:500 13px/1.25 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;text-align:left;cursor:pointer}.tt-editor-more-menu button:hover{background:color-mix(in srgb,currentColor 10%,transparent)}.tt-editor-more-menu button.tt-editor-more-destructive{color:var(--tt-destructive,#d70015)}
        .tt-field-row{display:flex;align-items:center;gap:10px;margin:2px 0;font-size:14px;color:var(--ink,#1d1d1f)}
        .tt-field-row.is-richtext{align-items:flex-start}
        .tt-field-label{flex:0 0 8.5rem;color:var(--muted,#6e6e73);font-size:12px;font-weight:600;letter-spacing:.01em}
        .tt-field-row.is-embedded{position:relative;width:100%;margin:0}
        .tt-field-row.is-embedded>.tt-field-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        .tt-field-row.is-embedded>.tt-field-input,.tt-field-row.is-embedded>.tt-field-multienum,.tt-field-row.is-embedded>.tt-rows-editor{width:100%}
        .tt-field-row.is-image.is-embedded{justify-content:center;margin:1.2rem 0}
        .tt-field-row.is-image.is-embedded .tt-image-field-control.is-canvas{position:relative;display:block;width:100%;overflow:visible}
        .tt-field-row.is-image.is-embedded .tt-image-field-preview{display:block;width:100%;height:auto;max-height:min(62vh,680px);border:0;border-radius:0;background:transparent;object-fit:cover}
        .tt-field-row.is-image.is-embedded .tt-image-field-actions{position:absolute;right:12px;bottom:12px;padding:4px;border:1px solid color-mix(in srgb,#fff 26%,transparent);border-radius:8px;background:rgba(29,29,31,.72);box-shadow:0 4px 14px rgba(0,0,0,.16);opacity:0;backdrop-filter:blur(18px) saturate(140%);transition:opacity 140ms ease}
        .tt-field-row.is-image.is-embedded .tt-image-field-control:hover .tt-image-field-actions,.tt-field-row.is-image.is-embedded .tt-image-field-control:focus-within .tt-image-field-actions{opacity:1}
        .tt-field-row.is-image.is-embedded .tt-image-field-actions button,.tt-field-row.is-image.is-embedded .tt-image-field-picker>summary{background:transparent;color:#fff}
        .tt-field-row.is-image.is-embedded .tt-image-field-actions button{color:#ff6961}
        .tt-field-input{flex:1 1 auto;min-width:0;box-sizing:border-box;padding:5px 8px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:14px}
        .tt-field-input:focus{outline:2px solid var(--tt-accent,#0071e3);outline-offset:1px;border-color:transparent}
        .tt-field-input.is-checkbox{flex:0 0 auto;width:16px;height:16px;accent-color:var(--tt-accent,#0071e3)}
        .tt-field-input.is-number{max-width:9rem}
        .tt-field-input.is-select{appearance:auto}
        .tt-field-details{max-width:44rem;margin:0 auto;padding:0 1.5rem 4rem}
        .tt-field-details-title{display:inline-flex;align-items:center;gap:7px;margin:0;padding:5px 0;color:var(--muted,#6e6e73);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;list-style:none}
        .tt-field-details-title::-webkit-details-marker{display:none}
        .tt-field-details-title::before{content:"›";display:inline-block;font-size:15px;line-height:1;transition:transform 140ms ease}
        .tt-field-details[open]>.tt-field-details-title::before{transform:rotate(90deg)}
        .tt-field-details-count{min-width:16px;padding:2px 5px;border-radius:999px;background:color-mix(in srgb,currentColor 14%,transparent);font-size:10px;letter-spacing:0;text-align:center}
        .tt-field-details-body{padding-top:.4rem}
        .tt-field-multienum{display:flex;flex-wrap:wrap;gap:6px}
        .tt-field-choice{padding:3px 10px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:999px;background:transparent;color:var(--ink,#1d1d1f);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
        .tt-field-choice.is-active{background:var(--tt-accent,#0071e3);border-color:var(--tt-accent,#0071e3);color:#fff}
        .tt-image-field-control{display:flex;flex:1 1 auto;align-items:center;min-width:0;gap:10px}.tt-image-field-preview,.tt-image-field-placeholder{display:grid;place-items:center;box-sizing:border-box;width:88px;height:56px;flex:0 0 88px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:6px;background:var(--ac-fill-4,rgba(118,118,128,.08));object-fit:cover;color:var(--muted,#6e6e73);font-size:11px}.tt-image-field-actions{display:flex;align-items:center;gap:6px}.tt-image-field-actions button,.tt-image-field-picker>summary{padding:5px 9px;border:0;border-radius:6px;background:var(--ac-fill-4,rgba(118,118,128,.1));color:var(--ink,#1d1d1f);font:500 12px/1.25 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;cursor:pointer;list-style:none}.tt-image-field-actions button{color:var(--tt-destructive,#d70015)}.tt-image-field-picker{position:relative}.tt-image-field-picker>summary::-webkit-details-marker{display:none}.tt-image-field-popover{position:absolute;z-index:360;top:calc(100% + 6px);left:0;box-sizing:border-box;width:min(320px,70vw);padding:12px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:8px;background:color-mix(in srgb,var(--paper,#fff) 94%,transparent);box-shadow:0 12px 32px rgba(0,0,0,.16);backdrop-filter:blur(24px) saturate(150%)}.tt-image-field-popover label{display:block;margin-bottom:6px;color:var(--muted,#6e6e73);font-size:11px;font-weight:600}
        .tt-rows-editor{display:flex;flex:1 1 auto;flex-direction:column;gap:6px;min-width:0}
        .tt-rows-editor-row{display:flex;align-items:center;gap:6px;min-width:0}
        .tt-rows-editor-row .tt-field-input{flex:1 1 0;min-width:3rem}
        .tt-rows-editor-row .tt-field-input.is-checkbox{flex:0 0 auto}
        .tt-rows-editor-remove{flex:0 0 auto;width:22px;height:22px;border:0;border-radius:50%;background:transparent;color:var(--muted,#6e6e73);font-size:15px;line-height:1;cursor:pointer}
        .tt-rows-editor-remove:hover{background:color-mix(in srgb,var(--ink,#1d1d1f) 8%,transparent)}
        .tt-rows-editor-add{align-self:flex-start;padding:4px 12px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:6px;background:transparent;color:var(--tt-accent,#0071e3);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
        @media(prefers-color-scheme:dark){.tt-unified-editor{--paper:#1c1c1e;--ink:#f5f5f7;--muted:#a1a1a6}.tt-field-input,.tt-field-choice,.tt-rows-editor-add{border-color:rgba(255,255,255,.18)}}
        @media(prefers-reduced-motion:reduce){.tt-unified-editor *{transition:none!important;animation:none!important}}
      `}</style>
    </section>
  );
}
