"use client";

/**
 * The open editor owns its live draft. Assistant actions use this bridge so
 * they read and patch that draft instead of creating a competing copy in the
 * pool store. Text ranges use JavaScript string offsets, matching textarea
 * selectionStart/selectionEnd and Markdown source offsets.
 */
export type WorkspaceItemTextField = "title" | "excerpt" | "body";

export type WorkspaceItemTextSelection = {
  field: WorkspaceItemTextField;
  start: number;
  end: number;
  text: string;
};

export type WorkspaceItemTextSnapshot = {
  title: string;
  excerpt: string;
  body: string;
  tags?: string[];
  selection?: WorkspaceItemTextSelection | null;
};

export type WorkspaceItemTextPatch = Partial<
  Pick<WorkspaceItemTextSnapshot, WorkspaceItemTextField | "tags">
>;

export type WorkspaceItemTextEdit = {
  field: WorkspaceItemTextField;
  range: { start: number; end: number };
  before: string;
  after: string;
  source: string;
  result: string;
};

type WorkspaceItemTextEditDirection = "apply" | "undo";

type WorkspaceItemTextEditResolution =
  | {
      ok: true;
      expected: WorkspaceItemTextPatch;
      patch: WorkspaceItemTextPatch;
    }
  | { ok: false; reason: "invalid" | "stale" };

type SelectionContextHint = {
  afterText?: string;
  beforeText?: string;
};

type OpenWorkspaceItemDraft = {
  read: () => WorkspaceItemTextSnapshot;
  apply: (patch: WorkspaceItemTextPatch) => void;
};

type OpenWorkspaceItemDraftEntry = {
  draft: OpenWorkspaceItemDraft;
  selection: WorkspaceItemTextSelection | null;
};

type OpenWorkspaceItemDraftPatchResult =
  | "applied"
  | "missing"
  | "stale";

const openDrafts = new Map<string, OpenWorkspaceItemDraftEntry>();
const listeners = new Set<() => void>();
let revision = 0;

function textFieldValue(
  snapshot: WorkspaceItemTextSnapshot,
  field: WorkspaceItemTextField,
): string {
  return snapshot[field];
}

function validRange(source: string, start: number, end: number): boolean {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end >= start &&
    end <= source.length
  );
}

function normalizeDomText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replaceAll("\u00a0", " ");
}

function sameSelection(
  left: WorkspaceItemTextSelection | null,
  right: WorkspaceItemTextSelection | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.field === right.field &&
    left.start === right.start &&
    left.end === right.end &&
    left.text === right.text
  );
}

function notifyDraftListeners() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function createWorkspaceItemTextSelection(
  field: WorkspaceItemTextField,
  source: string,
  start: number,
  end: number,
): WorkspaceItemTextSelection | null {
  if (!validRange(source, start, end) || start === end) return null;
  return { field, start, end, text: source.slice(start, end) };
}

/**
 * Maps a contenteditable text selection back to Markdown only when its source
 * location is unambiguous. Context hints may disambiguate repeated text; an
 * unresolved selection is intentionally dropped instead of targeting the
 * wrong range.
 */
export function locateWorkspaceItemTextSelection(
  field: WorkspaceItemTextField,
  source: string,
  selectedText: string,
  hint: SelectionContextHint = {},
): WorkspaceItemTextSelection | null {
  const needle = normalizeDomText(selectedText);
  if (!needle) return null;

  const candidates: number[] = [];
  let offset = source.indexOf(needle);
  while (offset !== -1) {
    candidates.push(offset);
    offset = source.indexOf(needle, offset + 1);
  }
  if (candidates.length === 0) return null;

  let resolved = candidates;
  if (candidates.length > 1) {
    const beforeText = normalizeDomText(hint.beforeText ?? "").slice(-80);
    const afterText = normalizeDomText(hint.afterText ?? "").slice(0, 80);
    resolved = candidates.filter((candidate) => {
      const beforeMatches =
        !beforeText || source.slice(0, candidate).endsWith(beforeText);
      const afterMatches =
        !afterText ||
        source.slice(candidate + needle.length).startsWith(afterText);
      return beforeMatches && afterMatches;
    });
  }

  if (resolved.length !== 1) return null;
  return createWorkspaceItemTextSelection(
    field,
    source,
    resolved[0],
    resolved[0] + needle.length,
  );
}

export function resolveWorkspaceItemTextSelection(
  snapshot: WorkspaceItemTextSnapshot,
): WorkspaceItemTextSelection | null {
  const selection = snapshot.selection;
  if (!selection) return null;
  const source = textFieldValue(snapshot, selection.field);
  if (!validRange(source, selection.start, selection.end)) return null;
  if (source.slice(selection.start, selection.end) !== selection.text) {
    return null;
  }
  return selection;
}

export function createWorkspaceItemTextEdit({
  after,
  end,
  field,
  source,
  start,
}: {
  after: string;
  end: number;
  field: WorkspaceItemTextField;
  source: string;
  start: number;
}): WorkspaceItemTextEdit | null {
  if (!validRange(source, start, end)) return null;
  const before = source.slice(start, end);
  return {
    field,
    range: { start, end },
    before,
    after,
    source,
    result: `${source.slice(0, start)}${after}${source.slice(end)}`,
  };
}

export function resolveWorkspaceItemTextEdit(
  snapshot: WorkspaceItemTextSnapshot,
  edit: WorkspaceItemTextEdit,
  direction: WorkspaceItemTextEditDirection,
): WorkspaceItemTextEditResolution {
  if (
    !validRange(edit.source, edit.range.start, edit.range.end) ||
    edit.source.slice(edit.range.start, edit.range.end) !== edit.before ||
    `${edit.source.slice(0, edit.range.start)}${edit.after}${edit.source.slice(
      edit.range.end,
    )}` !== edit.result
  ) {
    return { ok: false, reason: "invalid" };
  }

  const expectedValue = direction === "apply" ? edit.source : edit.result;
  if (snapshot[edit.field] !== expectedValue) {
    return { ok: false, reason: "stale" };
  }
  return {
    ok: true,
    expected: { [edit.field]: expectedValue },
    patch: {
      [edit.field]: direction === "apply" ? edit.result : edit.source,
    },
  };
}

export function registerOpenWorkspaceItemDraft(
  postId: string,
  draft: OpenWorkspaceItemDraft,
): () => void {
  const entry = { draft, selection: null };
  openDrafts.set(postId, entry);
  notifyDraftListeners();
  return () => {
    if (openDrafts.get(postId) !== entry) return;
    openDrafts.delete(postId);
    notifyDraftListeners();
  };
}

export function readOpenWorkspaceItemDraft(
  postId: string,
): WorkspaceItemTextSnapshot | null {
  const entry = openDrafts.get(postId);
  if (!entry) return null;
  const snapshot = entry.draft.read();
  const selection = resolveWorkspaceItemTextSelection({
    ...snapshot,
    selection: entry.selection,
  });
  if (entry.selection && !selection) entry.selection = null;
  return { ...snapshot, selection };
}

export function readOpenWorkspaceItemSelection(
  postId: string,
): WorkspaceItemTextSelection | null {
  return readOpenWorkspaceItemDraft(postId)?.selection ?? null;
}

export function setOpenWorkspaceItemSelection(
  postId: string,
  selection: WorkspaceItemTextSelection | null,
): boolean {
  const entry = openDrafts.get(postId);
  if (!entry) return false;
  const snapshot = entry.draft.read();
  const nextSelection = selection
    ? resolveWorkspaceItemTextSelection({ ...snapshot, selection })
    : null;
  if (sameSelection(entry.selection, nextSelection)) return true;
  entry.selection = nextSelection;
  notifyDraftListeners();
  return true;
}

export function patchOpenWorkspaceItemDraftIfCurrent(
  postId: string,
  patch: WorkspaceItemTextPatch,
  expected: WorkspaceItemTextPatch = {},
): OpenWorkspaceItemDraftPatchResult {
  const entry = openDrafts.get(postId);
  if (!entry) return "missing";
  const current = entry.draft.read();
  for (const field of ["title", "excerpt", "body"] as const) {
    if (expected[field] !== undefined && current[field] !== expected[field]) {
      return "stale";
    }
  }
  entry.draft.apply(patch);
  entry.selection = null;
  notifyDraftListeners();
  return "applied";
}

export function patchOpenWorkspaceItemDraft(
  postId: string,
  patch: WorkspaceItemTextPatch,
): boolean {
  return patchOpenWorkspaceItemDraftIfCurrent(postId, patch) === "applied";
}

export function subscribeOpenWorkspaceItemDrafts(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openWorkspaceItemDraftRevision(): number {
  return revision;
}

// Dev builds expose the read side on window so a live session can be
// interrogated from outside React. Selection bugs in this file are invisible
// otherwise: every writer fails silent by design.
declare const window: (Window & { __ttDraftDebug?: unknown }) | undefined;
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  window.__ttDraftDebug = {
    selection: readOpenWorkspaceItemSelection,
    draftIds: () => [...openDrafts.keys()],
    snapshot: readOpenWorkspaceItemDraft,
  };
}
