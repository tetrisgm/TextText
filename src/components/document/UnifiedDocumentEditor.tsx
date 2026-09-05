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
import {
  activeBodySelection,
  DOCUMENT_REDO_EVENT,
  DOCUMENT_UNDO_EVENT,
  registerDocumentHistory,
  requestDocumentCaret,
} from "@/lib/document-history-events";
import { setActiveDocumentBody } from "@/lib/document-outline";
import { promoteTab } from "@/lib/workspace/tabs";
import {
  DOCUMENT_REPLACE_EVENT,
  FOCUS_REPLACE_EVENT,
  replaceAllInText,
  requestDocumentReplaceAll,
  type ReplaceRequest,
} from "@/lib/document-replace";
import { Awareness } from "y-protocols/awareness";
import { formatArticleDate } from "@/lib/content";
import type { Blog, Post } from "@/lib/content";
import { CollabProvider, type PresencePeer } from "@/lib/collab/provider";
import { CollaboratorMark } from "@/components/collab/CollaboratorMark";
import { WorkspaceActionBarPortal } from "@/components/workspace/WorkspaceActionBarPortal";
import type { AssistantAgentIdentity } from "@/components/workspace/assistant/agent-identity";
import {
  registerOpenWorkspaceItemDraft,
  setOpenWorkspaceItemSelection,
} from "@/lib/ai/workspace-item-draft";
import {
  applyDocumentBaseline,
  applyDocumentSnapshot,
  documentSnapshotFromYDoc,
  documentRoot,
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
import {
  FieldInput,
  collectBoundFields,
} from "./FieldInput";
import type { WorkspaceReferenceChoice } from "@/lib/presentation/workspace-reference-choices";
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

type UnifiedDocumentEditorProps = {
  activeAgent?: AssistantAgentIdentity | null;
  onOpenAgent?: () => void;
  active?: boolean;
  blog: Blog;
  post: Post;
  template: TemplateDefinition;
  availableTemplates?: readonly TemplateDefinition[];
  referenceChoices?: readonly WorkspaceReferenceChoice[];
  collab: UnifiedEditorCollab;
  onDocumentChange?: (document: DocumentSnapshot) => void;
  onMaterialized?: (document: DocumentSnapshot, revision?: number) => void;
  onDone: () => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onChooseTemplate?: () => void;
  /**
   * Save this document's look under a name. Passed in rather than imported:
   * this component is a leaf, and importing a server action here drags the
   * auth graph into every unit test that renders it.
   */
  onSaveAsLook?: (name: string) => Promise<{ ok: boolean; message: string }>;
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
  // Chunked fromCharCode: the one-char-at-a-time loop built the binary
  // string with one allocation per byte, megabytes of GC churn per save of a
  // large document.
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, Math.min(index + CHUNK, bytes.length)),
    );
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

/**
 * Mirror of one Y.Text's current string, maintained so the per-keystroke
 * replaceYText need not walk the whole CRDT (Y.Text.toString() is O(document)
 * and was a per-keystroke cost at large bodies). `applying` marks the update
 * events replaceYText itself causes; every other update to the doc must
 * invalidate the mirror (see the doc-level subscription in the editor).
 */
type YTextMirror = { value?: string; applying: boolean };

function replaceYText(
  target: Y.Text,
  value: string,
  origin: unknown,
  mirror?: YTextMirror,
): void {
  const current = mirror?.value ?? target.toString();
  if (current === value) {
    if (mirror) mirror.value = value;
    return;
  }
  // Blockwise prefix/suffix scans: slice comparison is a memcmp, where the
  // per-character loop walked a multi-megabyte body one char per iteration on
  // every keystroke. The per-char step only runs inside the one block that
  // straddles the edit.
  const BLOCK = 2048;
  let prefix = 0;
  const sharedLength = Math.min(current.length, value.length);
  while (prefix < sharedLength) {
    const step = Math.min(BLOCK, sharedLength - prefix);
    if (
      step > 16 &&
      current.slice(prefix, prefix + step) === value.slice(prefix, prefix + step)
    ) {
      prefix += step;
      continue;
    }
    if (current[prefix] === value[prefix]) {
      prefix += 1;
      continue;
    }
    break;
  }
  let currentSuffix = current.length;
  let valueSuffix = value.length;
  while (currentSuffix > prefix && valueSuffix > prefix) {
    const step = Math.min(BLOCK, currentSuffix - prefix, valueSuffix - prefix);
    if (
      step > 16 &&
      current.slice(currentSuffix - step, currentSuffix) ===
        value.slice(valueSuffix - step, valueSuffix)
    ) {
      currentSuffix -= step;
      valueSuffix -= step;
      continue;
    }
    if (current[currentSuffix - 1] === value[valueSuffix - 1]) {
      currentSuffix -= 1;
      valueSuffix -= 1;
      continue;
    }
    break;
  }
  if (mirror) mirror.applying = true;
  try {
    target.doc?.transact(() => {
      if (currentSuffix > prefix) target.delete(prefix, currentSuffix - prefix);
      if (valueSuffix > prefix) target.insert(prefix, value.slice(prefix, valueSuffix));
    }, origin);
  } finally {
    if (mirror) {
      mirror.applying = false;
      mirror.value = value;
    }
  }
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

  const reportSelection = () => {
    const control = ref.current;
    if (!control) return;
    onSelection(field, control.selectionStart, control.selectionEnd);
  };

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

function Presence({ peers, activeAgent, onOpenAgent }: { peers: PresencePeer[]; activeAgent?: AssistantAgentIdentity | null; onOpenAgent?: () => void }) {
  const visiblePeers = activeAgent && !peers.some((peer) => peer.userName === activeAgent.name)
    ? [{ clientId: `selected-agent:${activeAgent.name}`, userName: activeAgent.name, color: activeAgent.color, awareness: null, participantType: "agent" as const, provider: activeAgent.provider }, ...peers]
    : peers;
  if (visiblePeers.length === 0) return null;
  return (
    <div className="tt-unified-presence" aria-label="Collaborators in this document">
      {visiblePeers.slice(0, 5).map((peer) => (
        peer.participantType === "agent" ? (
          <button
            key={peer.clientId}
            className="tt-agent-presence"
            type="button"
            onClick={onOpenAgent}
            title={`${peer.userName} is collaborating`}
          >
            <span
              className="tt-agent-avatar"
              style={{ backgroundColor: peer.color }}
            >
              <CollaboratorMark provider={peer.provider} name={peer.userName} />
            </span>
            <span className="tt-agent-name">{peer.userName}</span>
          </button>
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
  referenceChoices,
  collab,
  onDocumentChange,
  onMaterialized,
  onDone,
  onDelete,
  onChooseTemplate,
  onSaveAsLook,
  leadingControls,
  activeAgent,
  onOpenAgent,
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
  const networkEnabled = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    collab.postId,
  );
  const localOrigin = useRef(Symbol("unified-document-editor"));
  // A SEPARATE origin for edits the person actually made, so undo can track
  // those and nothing else. localOrigin also tags seeding and the pre-ready
  // reconciliation - tracking it would let the first Cmd+Z undo the seed and
  // empty the document.
  const userEditOrigin = useRef(Symbol("unified-document-editor:user-edit"));
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
  const [doc] = useState(() => {
    const next = new Y.Doc();
    if (!networkEnabled) {
      applyDocumentSnapshot(next, initialDocument, "initial-document");
    }
    return next;
  });
  /** Body-text mirror for replaceYText; see YTextMirror. */
  const bodyMirrorRef = useRef<YTextMirror>({ applying: false });
  // Undo, from the CRDT rather than the browser. The editable surface is
  // rendered by React from the source string, so the browser's own undo would
  // mutate DOM that React immediately rewrites - it cannot work here. Yjs
  // also gives the thing hand-rolled undo cannot: tracking ONLY this client's
  // edits, so undo never reaches through a collaborator's work.
  const undoManager = useMemo(
    () =>
      // The ROOT map, not the three Y.Texts. text() creates a Y.Text on
      // demand when the document is still empty, and a remote baseline
      // arriving afterwards supersedes it - so instances captured at mount
      // are orphaned by the time anyone types, and undo silently does
      // nothing. The root map is never replaced.
      new Y.UndoManager(
        documentRoot(doc),
        {
          trackedOrigins: new Set([userEditOrigin.current]),
          // Typing coalesces into one step per short burst, the way an editor
          // does, instead of one step per keystroke.
          captureTimeout: 400,
        },
      ),
    [doc],
  );
  const undoManagerRef = useRef(undoManager);
  useEffect(() => {
    undoManagerRef.current = undoManager;
    return () => undoManager.destroy();
  }, [undoManager]);
  // Sublime's undo behaviour: each step remembers where the caret was when it
  // was recorded, and undoing puts the caret back there rather than leaving
  // it wherever it happens to be. Yjs gives us the hook - stack items carry
  // their own metadata - so the selection rides with the step.
  useEffect(() => {
    const onAdded = (event: { stackItem: { meta: Map<string, unknown> } }) => {
      const selection = activeBodySelection();
      if (selection) event.stackItem.meta.set("tt-selection", selection);
    };
    const onPopped = (event: { stackItem: { meta: Map<string, unknown> } }) => {
      const selection = event.stackItem.meta.get("tt-selection") as
        | { anchor: number; head: number }
        | undefined;
      if (!selection) return;
      // After the document has been rewritten, not before.
      window.requestAnimationFrame(() =>
        requestDocumentCaret(selection.anchor, selection.head),
      );
    };
    undoManager.on("stack-item-added", onAdded);
    undoManager.on("stack-item-popped", onPopped);
    return () => {
      undoManager.off("stack-item-added", onAdded);
      undoManager.off("stack-item-popped", onPopped);
    };
  }, [undoManager]);
  // Replace-all goes through updateText, so it lands as one ordinary local
  // edit: it syncs like any other, and Cmd+Z takes it back in one step.
  const updateTextRef = useRef<
    ((field: EditableField, value: string) => void) | null
  >(null);
  const [findActive, setFindActive] = useState(false);
  const [findValue, setFindValue] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const findFieldRef = useRef<HTMLInputElement>(null);
  const replaceFieldRef = useRef<HTMLInputElement>(null);
  const runReplaceAll = useCallback(() => {
    if (!findValue) return;
    requestDocumentReplaceAll({ find: findValue, replace: replaceValue });
  }, [findValue, replaceValue]);
  useEffect(() => {
    const focus = () => {
      setFindActive(true);
      window.requestAnimationFrame(() => {
        findFieldRef.current?.focus();
        findFieldRef.current?.select();
      });
    };
    window.addEventListener(FOCUS_REPLACE_EVENT, focus);
    return () => window.removeEventListener(FOCUS_REPLACE_EVENT, focus);
  }, []);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ReplaceRequest>).detail;
      if (!detail?.find) return;
      const body = documentRef.current.content.body ?? "";
      const { text, count } = replaceAllInText(
        body,
        detail.find,
        detail.replace,
        { caseSensitive: detail.caseSensitive },
      );
      if (!count) return;
      updateTextRef.current?.("body", text);
    };
    window.addEventListener(DOCUMENT_REPLACE_EVENT, handler);
    return () => window.removeEventListener(DOCUMENT_REPLACE_EVENT, handler);
  }, []);

  useEffect(() => {
    const undo = () => undoManagerRef.current?.undo();
    const redo = () => undoManagerRef.current?.redo();
    window.addEventListener(DOCUMENT_UNDO_EVENT, undo);
    window.addEventListener(DOCUMENT_REDO_EVENT, redo);
    const release = registerDocumentHistory();
    return () => {
      window.removeEventListener(DOCUMENT_UNDO_EVENT, undo);
      window.removeEventListener(DOCUMENT_REDO_EVENT, redo);
      release();
    };
  }, []);
  useEffect(() => {
    // Any update replaceYText did not make itself (a remote edit, a baseline
    // merge, an applyDocumentSnapshot) can change the body text behind the
    // mirror's back. Drop it; the next keystroke re-reads once.
    const invalidate = () => {
      if (!bodyMirrorRef.current.applying) {
        bodyMirrorRef.current.value = undefined;
      }
    };
    doc.on("update", invalidate);
    return () => {
      doc.off("update", invalidate);
    };
  }, [doc]);
  const [awareness] = useState(() => new Awareness(doc));
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [remoteRevision, setRemoteRevision] = useState(0);
  const [ready, setReady] = useState(!networkEnabled);
  const readyRef = useRef(!networkEnabled);
  readyRef.current = ready;
  const [saveState, setSaveState] = useState<SaveState>("local");
  const [error, setError] = useState<string | null>(null);
  const [baselineFailure, setBaselineFailure] = useState<string | null>(null);
  const [providerAttempt, setProviderAttempt] = useState(0);
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  // "Save as look" is how a look gets made now. It takes what this document
  // already renders as and keeps it under a name; it never edits the document.
  const [savingLook, setSavingLook] = useState(false);
  const [namingLook, setNamingLook] = useState(false);
  const [lookName, setLookName] = useState("");
  const lookNameRef = useRef<HTMLInputElement>(null);
  const [lookNotice, setLookNotice] = useState<string | null>(null);
  const [showSubtitle, setShowSubtitle] = useState(false);
  const canAddSubtitle =
    !showSubtitle && !document.content.subtitle?.trim();
  const providerRef = useRef<CollabProvider | null>(null);
  const materializeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const materializeQueueRef = useRef(Promise.resolve());
  const localMaterializationVersionRef = useRef(0);
  const savedMaterializationVersionRef = useRef(0);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const subtitleRef = useRef<HTMLTextAreaElement>(null);
  const bodySurfaceRef = useRef<HTMLDivElement>(null);
  const publishDocument = useCallback(
    (next: DocumentSnapshot) => {
      documentRef.current = next;
      setDocument(next);
      onDocumentChange?.(next);
    },
    [onDocumentChange],
  );
  // Mount included: publishDocument only fires on CHANGES, so an untouched
  // document would never register its body and the outline would be empty on
  // exactly the documents most worth outlining.
  useEffect(() => {
    setActiveDocumentBody(document.content.body ?? "");
    return () => setActiveDocumentBody(null);
  }, [document]);

  const updateDocumentSnapshot = useCallback(
    (next: DocumentSnapshot) => {
      publishDocument(next);
      // userEditOrigin, not localOrigin: everything that reaches here is a
      // person changing the document - a field, the look it is rendered
      // with - so it belongs in undo alongside typing. Seeding and the
      // pre-ready reconciliation keep localOrigin and stay outside it.
      if (!hasDocumentSnapshot(doc) && (!networkEnabled || ready)) {
        applyDocumentSnapshot(doc, next, userEditOrigin.current);
      } else if (hasDocumentSnapshot(doc)) {
        applyDocumentSnapshot(doc, next, userEditOrigin.current);
        if (ready) preReadyLocalRef.current = null;
        else preReadyLocalRef.current = next;
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
      const localVersion = localMaterializationVersionRef.current;
      if (localVersion <= savedMaterializationVersionRef.current) {
        return Promise.resolve();
      }
      setSaveState("saving");
      const request = materializeQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          // Encode in an idle slot, never on the input path: the debounce
          // timer can fire in the middle of a typing burst, and encoding a
          // multi-megabyte doc there is a visible hitch. Idle time encodes
          // the latest state, which is at least as new as what was
          // scheduled. keepalive flushes (pagehide/unmount) cannot wait for
          // idle time that may never come, so they encode immediately.
          if (!keepalive && typeof requestIdleCallback === "function") {
            await new Promise<void>((resolve) => {
              requestIdleCallback(() => resolve(), { timeout: 1000 });
            });
          }
          const state = bytesToBase64(Y.encodeStateAsUpdate(doc));
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
          // The response describes the Y.Doc state this request materialized.
          // A person can keep editing while the request is in flight. Applying
          // an older response after that point replaces the live Y.Text with
          // the old snapshot and visibly resurrects deleted text.
          const responseIsCurrent =
            localMaterializationVersionRef.current === localVersion;
          if (result.document && responseIsCurrent) {
            applyDocumentSnapshot(doc, result.document, "materialized");
            publishDocument(result.document);
            onMaterialized?.(result.document, result.revision);
          }
          savedMaterializationVersionRef.current = Math.max(
            savedMaterializationVersionRef.current,
            localVersion,
          );
          // A later debounced flush is already scheduled for the newer local
          // version. Keep both the live document and its dirty cache entry
          // authoritative until that request is acknowledged.
          setSaveState(responseIsCurrent ? "saved" : "local");
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
      publishDocument,
    ],
  );

  const scheduleMaterialization = useCallback(() => {
    if (!networkEnabled || !collab.canEdit) return;
    localMaterializationVersionRef.current += 1;
    setSaveState("local");
    if (materializeTimerRef.current) clearTimeout(materializeTimerRef.current);
    materializeTimerRef.current = setTimeout(() => {
      materializeTimerRef.current = null;
      void flushMaterialization();
    }, 500);
  }, [collab.canEdit, doc, flushMaterialization, networkEnabled]);

  useEffect(() => {
    if (!networkEnabled) return;

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
          if (!hasDocumentSnapshot(doc)) {
            setBaselineFailure(message);
          }
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

    const handleDocumentUpdate = (_update: Uint8Array, origin: unknown) => {
      if (!hasDocumentSnapshot(doc)) return;
      if (origin === undoManagerRef.current) {
        // Undo/redo rewrote the CRDT under React. Republish unconditionally -
        // the remote branch below skips publishing while a local save is in
        // flight, which would leave the person's undo invisible - and save it.
        try {
          publishDocument(documentSnapshotFromYDoc(doc));
        } catch {
          setError("This document contains unsupported data.");
          return;
        }
        scheduleMaterialization();
        return;
      }
      const local =
        origin === localOrigin.current || origin === userEditOrigin.current;
      if (local) {
        // A local edit was published to React BEFORE it was applied to the
        // doc (updateText/updateDocumentSnapshot), so rebuilding the snapshot
        // from the doc and publishing it again only re-rendered the editor a
        // second time per keystroke - with a full Y.Text walk on top. Only
        // the save needs scheduling.
        scheduleMaterialization();
        return;
      }
      try {
        // A remote history arriving before the provider is ready must not
        // replace what the person already typed: the ledger holds that edit
        // and the reconciliation in provider.start().then() republishes the
        // merge. Publishing here first showed the server text for a beat and,
        // with a fast keystroke, for good (owner, 2026-09-05: a deletion came
        // back).
        if (!readyRef.current && preReadyLocalRef.current) return;
        const next = documentSnapshotFromYDoc(doc);
        const localSavePending =
          localMaterializationVersionRef.current >
          savedMaterializationVersionRef.current;
        if (localSavePending) return;
        publishDocument(next);
      } catch {
        setError("This document contains unsupported data.");
      }
    };
    doc.on("update", handleDocumentUpdate);

    if ((window as unknown as { __ttEditorInspect?: unknown }).__ttEditorInspect === true) {
      (window as unknown as { __ttEditor?: () => unknown }).__ttEditor = () => ({
        ready: readyRef.current,
        ledger: preReadyLocalRef.current?.content.body.length ?? null,
        ydoc: hasDocumentSnapshot(doc) ? documentText(doc, "body").toString().length : null,
        surface: documentRef.current.content.body.length,
      });
    }
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
          "provider-baseline",
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
      readyRef.current = true;
      setReady(true);
      setSaveState(result.authoritative ? "saved" : "offline");
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
    providerAttempt,
    scheduleMaterialization,
  ]);

  // Typing is the commitment that makes a preview tab permanent - not merely
  // having the document open in an editable view, which for a note is true
  // the moment it opens.
  const promoteOnEdit = useCallback(() => {
    if (collab.postId) promoteTab(collab.postId);
  }, [collab.postId]);

  const updateText = useCallback(
    (field: EditableField, value: string) => {
      promoteOnEdit();
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
      replaceYText(
        documentText(doc, field),
        normalized,
        userEditOrigin.current,
        field === "body" ? bodyMirrorRef.current : undefined,
      );
      if (!ready || !networkEnabled) setSaveState("local");
    },
    [
      currentLocalDocument,
      doc,
      networkEnabled,
      promoteOnEdit,
      publishDocument,
      ready,
    ],
  );
  updateTextRef.current = updateText;

  // The bridge the assistant reads through. Selections used to flow only
  // into Yjs awareness, which paints collaborative cursors and nothing else;
  // the draft store that feeds the assistant's context, the selection quick
  // actions, and the selection toolbar had lost its writer in a refactor, so
  // "Selected body text" could never appear and every selection feature was
  // quietly dead. The editor is the one thing that knows the live text, so it
  // registers the draft for as long as the item is open to edit.
  useEffect(() => {
    if (!collab.canEdit) return;
    const unregister = registerOpenWorkspaceItemDraft(collab.postId, {
      read: () => {
        const snapshot = currentLocalDocument();
        return {
          title: snapshot.content.title ?? "",
          excerpt: snapshot.content.subtitle ?? "",
          body: snapshot.content.body ?? "",
          tags: snapshot.content.tags,
        };
      },
      apply: (patch) => {
        if (typeof patch.title === "string") updateText("title", patch.title);
        if (typeof patch.excerpt === "string") updateText("subtitle", patch.excerpt);
        if (typeof patch.body === "string") updateText("body", patch.body);
      },
    });
    return unregister;
  }, [collab.canEdit, collab.postId, currentLocalDocument, updateText]);

  const updateSelection = useCallback(
    (field: EditableField, anchor: number, head: number) => {
      // The draft store names the subtitle field "excerpt"; same text, two
      // vocabularies.
      const draftField = field === "subtitle" ? "excerpt" : field;
      if (anchor < 0 || head < 0) {
        setOpenWorkspaceItemSelection(collab.postId, null);
      } else {
        const start = Math.min(anchor, head);
        const end = Math.max(anchor, head);
        // The live text is already in memory on the snapshot; walking the
        // Y.Text into a fresh string on EVERY caret move made a multi-MB
        // allocation per keystroke and arrow press.
        const content = currentLocalDocument().content;
        const fieldText =
          (field === "title"
            ? content.title
            : field === "subtitle"
              ? content.subtitle
              : content.body) ?? "";
        setOpenWorkspaceItemSelection(collab.postId, {
          field: draftField,
          start,
          end,
          text: fieldText.slice(start, end),
        });
      }
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
    [awareness, collab.postId, currentLocalDocument, doc, ready],
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

  // When this was written. A look that declares a metadata node is asking for
  // it, and the note-taking apps this engine answers to show it while typing.
  const editorDate = useMemo(
    () => formatArticleDate(post.updatedAt ?? post.date, { style: "short" }),
    [post.date, post.updatedAt],
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
        ...Object.fromEntries(
          activeTemplate.fields
            .filter((field) => field.visibility !== "hidden")
            .map((field) => [
            `content.fields.${field.id}`,
            <FieldInput
              key={field.id}
              field={field}
              value={document.content.fields[field.id]}
              onChange={(value) => updateField(field.id, value)}
              referenceChoices={referenceChoices}
              embedded
            />,
            ]),
        ),
      },
      // The body is markdown, and saying so here is what lets the renderer
      // hand it to a markdown surface instead of the plain one every other
      // binding gets.
      prose: {
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
      },
    }),
    [activeTemplate.fields, document.content.body, document.content.fields, document.content.subtitle, document.content.title, referenceChoices, remoteSelections, showSubtitle, updateField, updateSelection, updateText],
  );

  /** Declared fields the template does not bind anywhere in its item spec.
   * They still need an input, or a declared field is writable only by agents. */
  const unboundFields = useMemo(() => {
    const bound = collectBoundFields(activeTemplate.item);
    return activeTemplate.fields.filter(
      (field) => field.visibility !== "hidden" && !bound.has(field.id),
    );
  }, [activeTemplate]);
  const retryBaseline = useCallback(() => {
    setBaselineFailure(null);
    setError(null);
    setSaveState("local");
    setProviderAttempt((attempt) => attempt + 1);
  }, []);
  const saveStateLabel =
    saveState === "local"
      ? networkEnabled
        ? "Saved"
        : "Saved on this device"
      : saveState === "offline"
        ? "Saved on this device"
        : saveState === "error"
          ? error ?? "Could not sync"
          : saveState === "saving"
            ? "Saving"
            : saveState === "saved"
              ? "Saved"
              : "";

  if (!active) return null;
  if (baselineFailure && !hasDocumentSnapshot(doc)) {
    return (
      <section className="tt-unified-editor tt-baseline-failure" role="alert">
        <div className="tt-baseline-failure-copy">
          <h1>This document could not be loaded for editing</h1>
          <button type="button" className="ac-btn ac-btn-gray" onClick={retryBaseline}>
            Retry
          </button>
        </div>
      </section>
    );
  }
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
      <WorkspaceActionBarPortal>
        <div className="post-top-action-bar applecms is-edit" aria-label="Document controls">
          <div className="post-action-toolbar ac-chrome">
            {leadingControls}
        <Presence peers={peers} activeAgent={activeAgent} onOpenAgent={onOpenAgent} />
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
          {lookNotice && (
            <span className="tt-look-notice" role="status">
              {lookNotice}
            </span>
          )}
          {(
            <details className="tt-editor-more">
            <summary aria-label="More actions" title="More actions">
              <span aria-hidden="true">•••</span>
            </summary>
            <div className="tt-editor-more-menu">
              {/* Naming happens in the menu, not in a window.prompt. The
                  browser dialog was a grey system box with the page frozen
                  behind it, which is the exact jank the look work was meant to
                  remove. */}
              {onSaveAsLook && !namingLook && (
                <button
                  type="button"
                  disabled={savingLook}
                  onClick={() => {
                    setLookName(`${activeTemplate.name} copy`);
                    setNamingLook(true);
                    window.requestAnimationFrame(() =>
                      lookNameRef.current?.select(),
                    );
                  }}
                >
                  Save as look
                </button>
              )}
              {onSaveAsLook && namingLook && (
                <form
                  className="tt-editor-more-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = lookName.trim();
                    if (!name) return;
                    setSavingLook(true);
                    setLookNotice("Saving look...");
                    setNamingLook(false);
                    void onSaveAsLook(name)
                      .then((result) => setLookNotice(result.message))
                      .catch(() => setLookNotice("Could not save that look."))
                      .finally(() => setSavingLook(false));
                  }}
                >
                  <input
                    ref={lookNameRef}
                    aria-label="Name this look"
                    value={lookName}
                    disabled={savingLook}
                    maxLength={160}
                    onChange={(event) => setLookName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setNamingLook(false);
                      }
                    }}
                  />
                  <button type="submit" disabled={savingLook || !lookName.trim()}>
                    {savingLook ? "Saving" : "Save"}
                  </button>
                </form>
              )}
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
            <div className={`tt-save-state is-${saveState}`} role="status" aria-live="polite">
              {saveStateLabel}
            </div>
          </div>
        </div>
      </WorkspaceActionBarPortal>
      {findActive && (
        <div className="post-action-find-row" role="search" aria-label="Find and replace">
          {/* Replace lands as one ordinary edit through updateText, which is
              why Cmd+Z takes the whole change back in a single step. */}
          <div className="post-action-replace">
            <input
              ref={findFieldRef}
              className="post-action-replace-input"
              type="text"
              aria-label="Find in document"
              placeholder="Find"
              value={findValue}
              onChange={(event) => setFindValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  replaceFieldRef.current?.focus();
                  return;
                }
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                if (findValue) setFindValue("");
                else setFindActive(false);
              }}
            />
            <input
              ref={replaceFieldRef}
              className="post-action-replace-input"
              type="text"
              aria-label="Replace with"
              placeholder="Replace with"
              value={replaceValue}
              onChange={(event) => setReplaceValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runReplaceAll();
                  return;
                }
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                if (replaceValue) setReplaceValue("");
                else setFindActive(false);
              }}
            />
            <button
              type="button"
              className="ac-btn ac-btn-gray post-action-replace-run"
              disabled={!findValue}
              onClick={runReplaceAll}
            >
              Replace all
            </button>
          </div>
        </div>
      )}
      {/* No byline while writing: an author and a reading time are reader
          chrome, and showing them here turns the page into a preview of
          itself instead of the thing being written.

          The DATE is different. It is when you wrote this, a look that
          declares a metadata node is asking for it as part of its design, and
          the note-taking apps this engine answers to all show it while you
          type. Withholding it meant a look could ask for a date line and get
          nothing in the one place its author was looking. */}
      <DocumentRenderer
        document={document}
        documentId={post.id ?? post.slug}
        template={activeTemplate}
        metadata={{ date: editorDate }}
        slots={slots}
        className="tt-document-editor"
      />
      {unboundFields.length > 0 && (
        // Fields the look declares but does not place stay one level down, so
        // the writing surface is a document rather than a form.
        // Open. These are fields the look declared and did not place, and a
        // closed drawer over a task's due date means the thing cannot be used
        // without hunting for it. A look that places its fields never gets
        // here at all, so this only ever shows what would otherwise be lost.
        <details className="tt-field-details" open>
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
                referenceChoices={referenceChoices}
              />
            ))}
          </div>
        </details>
      )}
      <style>{`
        .tt-unified-editor{min-height:100%;background:var(--paper,#fff)}
        .tt-document-editor{min-height:100vh;padding-bottom:3rem}
        @media(max-width:700px){.tt-document-editor{padding-top:56px}.tt-look-name{display:none}.tt-field-row.is-embedded{grid-template-columns:1fr;gap:5px;padding-inline:8px}}
        .tt-document-editor .tt-collaborative-field{position:relative;width:100%;min-width:0}
        .tt-document-editor .tt-collaborative-field textarea,.tt-document-editor .tt-collaborative-mirror{box-sizing:border-box;width:100%;margin:0;padding:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;line-height:inherit;letter-spacing:0;white-space:pre-wrap;overflow-wrap:anywhere;resize:none;text-align:inherit}
        .tt-document-editor .tt-collaborative-field textarea{position:relative;z-index:2;display:block;caret-color:var(--tt-accent);overflow:visible}
        /* Nothing is drawn around the writing. The caret is the focus
           indicator, the way it is in every editor people actually like. A
           tinted field turns a document into a form, and at body height that
           tint was a coloured panel behind the whole page. High contrast is
           the exception: there a caret is easy to lose, so it gets a real
           outline. */
        @media(forced-colors:active){.tt-document-editor .tt-collaborative-field:focus-within::before{content:"";position:absolute;inset:-4px -8px;outline:2px solid Highlight;pointer-events:none}}
        .tt-document-editor .tt-collaborative-mirror{position:absolute;z-index:1;inset:0;pointer-events:none;overflow:hidden;color:transparent}
        .tt-document-editor .tt-collaborative-mirror mark{background:color-mix(in srgb,var(--tt-peer) 28%,transparent);color:transparent;border-radius:2px}
        .tt-document-editor .tt-remote-caret{position:relative;border-inline-start:2px solid var(--tt-peer);margin-inline-start:-1px;color:transparent}
        .tt-document-editor .tt-remote-caret>span{position:absolute;left:-2px;bottom:100%;padding:2px 5px;background:var(--tt-peer);color:#fff;font:600 10px/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;white-space:nowrap;border-radius:3px}
        .tt-document-editor .tt-field-body textarea,.tt-document-editor .tt-field-body .tt-collaborative-mirror{min-height:36vh;text-align:start}
        /* The writing surface renders the source itself, styled, so what you
           type looks like what a reader gets without the document stopping
           being Markdown. */
        /* A look spaces its masthead for what it publishes: a byline, a date,
           a cover. Edit mode hides those, so the published gap became a hole
           between the title and the first line you write - 44px of nothing on
           Article. Fall back to the look's own comfortable gap, which still
           varies with its density, so looks stay distinct while writing. */
        .tt-document.tt-document-editor[data-template]:not(.tt-collection-item)>.tt-stack{gap:var(--tt-gap-md)}
        .tt-md-surface{min-height:36vh;outline:0;white-space:pre-wrap;overflow-wrap:anywhere;text-align:start;caret-color:var(--tt-accent,#0071e3)}
        /* Each line is its own block so a keystroke relayouts one line, not
           the document: one giant inline formatting context cost ~1.9s to lay
           out at a 900kB body, which was the entire input lag. The literal
           newline character stays in the text (every offset depends on it)
           but renders zero-height, because the block break already shows it. */
        .tt-md-surface>[data-tt-ln]{display:block}
        .tt-md-nl{font-size:0;line-height:0}
        .tt-md-surface[data-empty="true"]::before{content:attr(data-placeholder);color:var(--muted,#6e6e73);pointer-events:none}
        /* Syntax the styling already speaks for shows only on the line you are
           writing on. The markers stay in the DOM, so textContent is still
           exactly the source and every character offset is unmoved; only their
           display changes. List and quote markers are not in this set: nothing
           else on the line says "list". */
        .tt-md-marker{color:color-mix(in srgb,currentColor 32%,transparent);font-weight:400}
        .tt-md-syntax{display:none}
        .tt-md-syntax.is-open{display:inline}
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
        .tt-save-state{position:fixed;right:calc(72px + var(--workspace-rail-inset,0px));bottom:calc(24px + var(--workspace-hints-height,0px));z-index:220;min-height:1rem;padding:5px 9px;border:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 12%,transparent);border-radius:6px;background:var(--paper,#fff);color:var(--muted,#6e6e73);font-size:12px;pointer-events:none}
        .tt-save-state:empty{display:none}.tt-save-state.is-error{color:#b42318}@media(prefers-color-scheme:dark){.tt-save-state.is-error{color:#ff8a80}}
        .tt-look-button{display:inline-flex;align-items:center;gap:5px}.tt-look-name{max-width:9rem;overflow:hidden;color:var(--muted,#6e6e73);font-weight:500;text-overflow:ellipsis;white-space:nowrap}
        .tt-editor-more{position:relative}.tt-editor-more>summary{display:grid;place-items:center;box-sizing:border-box;min-width:30px;height:30px;padding:0 8px;border:0;border-radius:6px;background:var(--ac-fill-4,rgba(118,118,128,.12));color:var(--ink,#1d1d1f);font:700 11px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;letter-spacing:1px;cursor:pointer;list-style:none}.tt-editor-more>summary::-webkit-details-marker{display:none}.tt-editor-more[open]>summary{background:var(--ac-fill-3,rgba(118,118,128,.2))}
        .tt-editor-more-menu{position:absolute;z-index:420;top:calc(100% + 6px);right:0;min-width:160px;padding:5px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:8px;background:color-mix(in srgb,var(--paper,#fff) 94%,transparent);box-shadow:0 12px 32px rgba(0,0,0,.16);backdrop-filter:blur(24px) saturate(150%)}.tt-editor-more-menu button{width:100%;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:var(--ink,#1d1d1f);font:500 13px/1.25 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;text-align:left;cursor:pointer}.tt-editor-more-menu button:hover{background:color-mix(in srgb,currentColor 10%,transparent)}.tt-editor-more-menu button.tt-editor-more-destructive{color:var(--tt-destructive,#d70015)}
        .tt-field-row{display:flex;align-items:center;gap:10px;margin:2px 0;font-size:14px;color:var(--ink,#1d1d1f)}
        .tt-field-row.is-richtext{align-items:flex-start}
        .tt-field-label{flex:0 0 8.5rem;color:var(--muted,#6e6e73);font-size:12px;font-weight:600;letter-spacing:.01em}
        .tt-field-row.is-embedded{position:relative;display:grid;grid-template-columns:minmax(6.5rem,8.5rem) minmax(0,1fr);align-items:center;gap:12px;width:100%;box-sizing:border-box;margin:0;padding:4px 12px}
        .tt-field-row.is-embedded>.tt-field-label{position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip:auto;white-space:normal;border:0}
        .tt-field-row.is-embedded>.tt-field-input,.tt-field-row.is-embedded>.tt-field-multienum,.tt-field-row.is-embedded>.tt-rows-editor,.tt-field-row.is-embedded>.tt-people-picker,.tt-field-row.is-embedded>.tt-status-workflow-control{width:100%}
        .tt-field-row.is-embedded>.tt-field-input.is-checkbox{width:16px;justify-self:start}
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
        .tt-status-workflow-control{flex:1 1 auto;min-width:0;display:grid;gap:4px}
        .tt-status-workflow-control>small{color:var(--muted,#6e6e73);font-size:11px;line-height:1.3}
        .tt-people-picker{position:relative;flex:1 1 auto;min-width:0;display:grid;gap:7px}
        .tt-people-selection{display:flex;flex-wrap:wrap;gap:6px}
        .tt-people-empty{color:var(--muted,#6e6e73);font-size:12px}
        .tt-person-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 5px 3px 3px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:999px;background:color-mix(in srgb,var(--ink,#1d1d1f) 4%,transparent);font-size:12px;font-weight:600}
        .tt-person-chip>span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .tt-person-chip>button{display:grid;width:18px;height:18px;place-items:center;padding:0;border:0;border-radius:50%;background:transparent;color:var(--muted,#6e6e73);font:inherit;cursor:pointer}
        .tt-person-chip>button:hover{background:color-mix(in srgb,var(--ink,#1d1d1f) 9%,transparent);color:var(--ink,#1d1d1f)}
        .tt-person-avatar{display:grid;flex:0 0 24px;width:24px;height:24px;place-items:center;border-radius:50%;background:color-mix(in srgb,var(--tt-accent,#0071e3) 14%,var(--paper,#fff));color:var(--tt-accent,#0071e3);font-size:10px;font-weight:750;letter-spacing:.02em}
        .tt-people-picker-menu{position:relative;width:100%;max-width:100%;font-size:12px}
        .tt-people-manual{position:relative;width:max-content;max-width:100%;font-size:12px}
        .tt-people-picker-menu>summary,.tt-people-manual>summary{width:max-content;max-width:100%;padding:0;border:0;color:var(--tt-accent,#0071e3);font-weight:650;cursor:pointer;list-style:none}
        .tt-people-picker-menu>summary::-webkit-details-marker,.tt-people-manual>summary::-webkit-details-marker{display:none}
        .tt-people-picker-menu>summary[aria-disabled=true],.tt-people-manual>summary[aria-disabled=true]{opacity:.45;cursor:default}
        .tt-people-picker-popover{position:absolute;left:0;z-index:40;width:min(320px,calc(100vw - 32px));margin-top:7px;padding:8px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:10px;background:var(--paper,#fff);box-shadow:0 16px 44px rgba(0,0,0,.16)}
        .tt-people-picker-popover>.tt-field-input{width:100%;margin-bottom:7px}
        .tt-people-options{display:grid;gap:2px;max-height:240px;overflow:auto}
        .tt-people-options>button{display:grid;grid-template-columns:24px minmax(0,1fr) 18px;align-items:center;gap:8px;width:100%;padding:7px;border:0;border-radius:7px;background:transparent;color:var(--ink,#1d1d1f);text-align:left;cursor:pointer}
        .tt-people-options>button:hover,.tt-people-options>button.is-selected{background:color-mix(in srgb,var(--ink,#1d1d1f) 7%,transparent)}
        .tt-people-options>button>span:nth-child(2){display:grid;min-width:0}
        .tt-people-options strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
        .tt-people-options small{color:var(--muted,#6e6e73);font-size:10px}
        .tt-people-options>p{margin:10px;color:var(--muted,#6e6e73);text-align:center}
        .tt-people-manual[open]{width:100%}
        .tt-people-manual>div{display:flex;align-items:center;gap:6px;margin-top:6px}
        .tt-people-manual .tt-field-input{width:100%}
        .tt-people-manual button{padding:5px 10px;border:1px solid var(--ac-hairline,#d2d2d7);border-radius:6px;background:transparent;color:var(--ink,#1d1d1f);font:inherit;font-weight:650;cursor:pointer}
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
        @media(max-width:700px){.tt-people-picker-popover{right:0;left:auto}}
        @media(prefers-color-scheme:dark){.tt-unified-editor{--paper:#1c1c1e;--ink:#f5f5f7;--muted:#a1a1a6}.tt-field-input,.tt-field-choice,.tt-rows-editor-add,.tt-person-chip,.tt-people-picker-popover,.tt-people-manual button{border-color:rgba(255,255,255,.18)}}
        @media(prefers-reduced-motion:reduce){.tt-unified-editor *{transition:none!important;animation:none!important}}
      `}</style>
    </section>
  );
}
