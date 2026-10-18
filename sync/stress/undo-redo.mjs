// Bounded evidence for real editor keyboard history. No simulated product claim.
export const HISTORY_DEADLINE_MS = 15000;
// Product UnifiedDocumentEditor captureTimeout is 400 ms.
export const HISTORY_CAPTURE_IDLE_MS = 450;
const STAGES = ['insert', 'undo', 'redo'];
export function validateUndoRedo(edit) {
  return edit?.undoRedo === undefined || (edit.undoRedo === true && edit.op === 'append'
    && edit.inputSequence === undefined && typeof edit.text === 'string' && edit.text.length > 0 && edit.text.length <= 1024);
}
export function checkUndoRedoProgress(edit, progress, complete = true) {
  if (!edit.undoRedo) return progress === undefined;
  if (!validateUndoRedo(edit) || !progress || progress.editId !== edit.id || !Array.isArray(progress.stages)
    || progress.stages.length > 3 || (complete && progress.stages.length !== 3)) return false;
  let previous = -1;
  for (const [index, stage] of progress.stages.entries()) {
    if (stage.stage !== STAGES[index] || stage.editId !== edit.id || stage.text !== edit.text
      || stage.ownOccurrences !== (index === 1 ? 0 : 1) || stage.preservedVisibleContent !== true
      || !Number.isFinite(stage.elapsedMs) || stage.elapsedMs <= previous || stage.elapsedMs < HISTORY_CAPTURE_IDLE_MS || stage.elapsedMs > HISTORY_DEADLINE_MS) return false;
    previous = stage.elapsedMs;
  }
  if (progress.attemptedStage !== undefined && (complete || progress.attemptedStage !== STAGES[progress.stages.length])) return false;
  return true;
}
// snapshot returns real visible text; preserve checks may conservatively fail
// during concurrent remote deletion, but can never turn data loss into a pass.
export async function exerciseUndoRedo(edit, { insert, undo, redo, snapshot, now, sleep, progress }) {
  if (!edit.undoRedo || !validateUndoRedo(edit)) throw new Error('invalid undo/redo operation');
  const start = now();
  await sleep(HISTORY_CAPTURE_IDLE_MS);
  const baseline = await snapshot();
  let preserved = baseline;
  if (baseline.includes(edit.text)) throw new Error('undo/redo marker already present');
  for (const [index, action] of [insert, undo, redo].entries()) {
    if (index > 0) await sleep(1);
    progress.attemptedStage = STAGES[index];
    await action(index === 0 ? edit.text : undefined);
    const expected = index === 1 ? 0 : 1;
    for (;;) {
      const text = await snapshot(), occurrences = text.split(edit.text).length - 1;
      const stripped = text.split(edit.text).join('');
      if (occurrences === expected && preservesSubsequence(stripped, preserved)) {
        const elapsedMs = now() - start;
        if (elapsedMs > HISTORY_DEADLINE_MS) throw new Error('undo/redo deadline exceeded');
        progress.stages.push({ stage: STAGES[index], editId: edit.id, text: edit.text,
          ownOccurrences: expected, preservedVisibleContent: true, elapsedMs });
        delete progress.attemptedStage;
        preserved = stripped;
        break;
      }
      if (now() - start >= HISTORY_DEADLINE_MS) throw new Error('undo/redo visible history or preservation check failed');
      await sleep(25);
    }
  }
}
export function preservesSubsequence(text, prior) {
  let offset = 0; const characters = [...prior];
  for (const char of text) if (char === characters[offset]) offset++;
  return offset === characters.length;
}
