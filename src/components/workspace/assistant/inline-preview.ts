import {
  assertSelectionMatches, createSelectionEnvelope, validateSelectionEnvelope,
  SELECTION_INVALID_ERROR, SELECTION_STALE_ERROR, type SelectionEnvelope,
} from "@/lib/ai/selection-envelope";
import type { WorkspaceItemTextSelection, WorkspaceItemTextSnapshot } from "@/lib/ai/workspace-item-draft";
import { createAssistantTextDeltaBuffer } from "./text-delta-buffer";

export const INLINE_ACTIONS = [
  { id: "rewrite", label: "Rewrite", title: "Preview a rewrite of the selection" },
  { id: "summarize", label: "Summarize", title: "Summarize the selection" },
  { id: "excerpt", label: "Set document excerpt", title: "Draft the document excerpt from this selection" },
  { id: "translate", label: "Translate", title: "Translate the selection" },
  { id: "continue", label: "Continue writing", title: "Continue after the selection" },
] as const;
export type InlineAction = typeof INLINE_ACTIONS[number]["id"];
export type InlineStatus = "generating" | "ready" | "applying" | "applied" | "stale" | "failed" | "discarded" | "undone";
export type InlineRequest = {
  itemId: string; action: InlineAction; selection: WorkspaceItemTextSelection; language?: string;
};
export type InlinePreviewRecord = {
  action: InlineAction; itemId: string; title: string; words: number;
  status: InlineStatus; text: string; envelope?: SelectionEnvelope; error?: string;
  /** True after a write was sent but its acknowledgment was lost. Never retry it. */
  uncertain?: boolean;
  appliedEdit?: InlineEdit;
};
export type InlineEdit = {
  field: WorkspaceItemTextSelection["field"]; start: number; end: number;
  expected_text: string; replacement_text: string; selection_envelope?: SelectionEnvelope;
};
type Dependencies = {
  read: () => Promise<WorkspaceItemTextSnapshot>;
  generate: (envelope: SelectionEnvelope, prompt: string, signal: AbortSignal, delta: (text: string) => void) => Promise<{ text: string; selectionEnvelope?: SelectionEnvelope }>;
  execute: (edit: InlineEdit) => Promise<void>;
  persist: (record: InlinePreviewRecord) => void;
  active: () => boolean;
};
export function inlinePrompt(request: InlineRequest): string {
  const action = request.action === "translate"
    ? `Translate the entire selection into ${request.language === "Document language" ? "the primary language of the document (read the document if needed)" : request.language?.trim() || "English"}.`
    : request.action === "continue"
      ? "Write a continuation immediately after the selection. Return only the new continuation, without repeating the selection. Include the leading and trailing whitespace needed at the insertion point."
      : request.action === "excerpt"
        ? "Write a concise document excerpt based on the selection."
        : `${request.action === "rewrite" ? "Rewrite" : "Summarize"} the entire selection.`;
  return `${action} Return only the suggested text. Do not change the item.`;
}
export function inlineEdit(record: InlinePreviewRecord, item: WorkspaceItemTextSnapshot, replace = false): InlineEdit {
  const e = record.envelope!;
  if (record.action === "excerpt") return {
    field: "excerpt", start: 0, end: item.excerpt.length,
    expected_text: item.excerpt, replacement_text: record.text,
  };
  const suffix = item[e.field].slice(e.end);
  const below = record.action === "summarize" && !replace;
  const beforeBreak = e.text.endsWith("\n\n") ? "" : e.text.endsWith("\n") ? "\n" : "\n\n";
  const afterBreak = !suffix || suffix.startsWith("\n\n") ? "" : suffix.startsWith("\n") ? "\n" : "\n\n";
  return {
    field: e.field, start: e.start, end: e.end, expected_text: e.text,
    replacement_text: record.action === "continue" ? e.text + record.text
      : below ? e.text + beforeBreak + record.text + afterBreak : record.text,
    selection_envelope: e,
  };
}

/** One preview owns one abort signal and one frozen passage. No model text is
 * writable until completion acknowledges the same validated envelope. */
export function createInlinePreview(request: InlineRequest, deps: Dependencies) {
  let state: InlinePreviewRecord = {
    action: request.action, itemId: request.itemId, title: "Current item",
    words: request.selection.text.trim().split(/\s+/u).filter(Boolean).length,
    status: "generating", text: "",
  };
  let source: WorkspaceItemTextSnapshot | undefined;
  let applied: { edit: InlineEdit; result: string } | undefined;
  let controller: AbortController | undefined;
  let generation = 0;
  let started = false;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<InlinePreviewRecord>, durable = true) => {
    state = { ...state, ...patch };
    if (durable) deps.persist(state);
    listeners.forEach((listener) => listener());
  };
  const active = () => deps.active() && state.status !== "discarded" && state.status !== "undone";
  const fail = (error: unknown) => emit({
    status: error instanceof Error && error.message === SELECTION_STALE_ERROR ? "stale" : "failed",
    error: error instanceof Error ? error.message : "Could not generate this preview. Try again.",
  });
  async function generate(selection = request.selection) {
    if (!active() || state.status === "applying" || state.status === "applied" || state.uncertain) return;
    controller?.abort();
    const turn = ++generation;
    const abort = new AbortController();
    controller = abort;
    const live = () => active() && turn === generation && !abort.signal.aborted;
    emit({ status: "generating", text: "", error: undefined, envelope: undefined });
    const buffer = createAssistantTextDeltaBuffer((text) => {
      if (live() && state.status === "generating") emit({ text: state.text + text }, false);
    });
    try {
      const read = await deps.read();
      if (!live()) return;
      source = read;
      const envelope = await createSelectionEnvelope(request.itemId, source, selection);
      if (!envelope) throw new Error(SELECTION_INVALID_ERROR);
      emit({ envelope, title: source.title || "Untitled", words: envelope.text.trim().split(/\s+/u).filter(Boolean).length });
      const answer = await deps.generate(envelope, inlinePrompt(request), abort.signal, buffer.push);
      buffer.finish();
      if (!live()) return;
      const acknowledged = await validateSelectionEnvelope(answer.selectionEnvelope);
      if (acknowledged.hash !== envelope.hash) throw new Error(SELECTION_INVALID_ERROR);
      if (!answer.text.trim()) throw new Error("No suggestion was returned. Try again.");
      const current = await deps.read();
      if (!live()) return;
      assertSelectionMatches(envelope, request.itemId, current);
      emit({ status: "ready", text: request.action === "continue" ? answer.text : answer.text.trim() });
    } catch (error) {
      if (live()) fail(error);
    } finally {
      buffer.cancel();
    }
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() { if (!started) { started = true; void generate(); } },
    stop() {
      if (state.status !== "generating") return;
      ++generation;
      controller?.abort();
      emit({ status: "failed", error: "Generation stopped. Retry for a complete suggestion." });
    },
    discard() {
      if (state.status === "applying" || state.status === "applied") return false;
      ++generation;
      controller?.abort();
      emit({ status: "discarded" });
      return true;
    },
    retry(selection?: WorkspaceItemTextSelection | null) {
      if (state.status !== "failed" && state.status !== "stale") return;
      // A changed range must be selected again. A revision-only change can
      // regenerate the same exact passage safely.
      void generate(selection ?? state.envelope ?? request.selection);
    },
    check(current: WorkspaceItemTextSnapshot | null) {
      if (!state.envelope || !["generating", "ready"].includes(state.status)) return;
      try {
        if (!current) throw new Error(SELECTION_STALE_ERROR);
        assertSelectionMatches(state.envelope, request.itemId, current);
      } catch {
        ++generation;
        controller?.abort();
        emit({ status: "stale", error: "The passage changed. Select it again to regenerate." });
      }
    },
    async accept(replace = false) {
      if (!active() || state.status !== "ready" || !source || !state.envelope) return;
      // Lock before the first await so double clicks cannot send two writes.
      emit({ status: "applying", error: undefined });
      let sent = false;
      try {
        const current = await deps.read();
        if (!active()) throw new Error(SELECTION_STALE_ERROR);
        await validateSelectionEnvelope(state.envelope);
        assertSelectionMatches(state.envelope, request.itemId, current);
        if (state.action === "excerpt" && current.excerpt !== source.excerpt) throw new Error(SELECTION_STALE_ERROR);
        const edit = inlineEdit(state, current, replace);
        sent = true;
        await deps.execute(edit);
        applied = { edit, result: current[edit.field].slice(0, edit.start) + edit.replacement_text + current[edit.field].slice(edit.end) };
        emit({ status: "applied", appliedEdit: edit });
      } catch (error) {
        if (sent && !(error instanceof Error && error.message === SELECTION_STALE_ERROR)) emit({ status: "failed", uncertain: true, error: "Could not confirm the change. Check the document before making another edit." });
        else fail(error);
      }
    },
    async undo() {
      if (!active() || state.status !== "applied" || !applied || state.uncertain) return;
      emit({ status: "applying", error: undefined });
      let sent = false;
      try {
        const current = await deps.read();
        if (!active() || current[applied.edit.field] !== applied.result) throw new Error(SELECTION_STALE_ERROR);
        const edit = applied.edit;
        sent = true;
        await deps.execute({ field: edit.field, start: edit.start, end: edit.start + edit.replacement_text.length,
          expected_text: edit.replacement_text, replacement_text: edit.expected_text });
        emit({ status: "undone" });
      } catch {
        emit({ status: "applied", error: sent ? "Could not confirm Undo. Check the document." : "The passage changed. Undo would overwrite newer text.", uncertain: sent });
      }
    },
    dispose() {
      ++generation;
      controller?.abort();
      if (state.status === "generating") emit({ status: "failed", error: "Generation stopped when you left the document." });
      listeners.clear();
    },
  };
}
export type InlinePreviewController = ReturnType<typeof createInlinePreview>;
