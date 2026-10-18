// Bounded real-input protocol shared by the coordinator and browser adapter.
export const INPUT_DEADLINE_MS = 15000;
export function validateInputSequence(edit) {
  const s = edit?.inputSequence;
  if (s === undefined) return true;
  return edit.op === 'append' && s && Array.isArray(s.chunks) && s.chunks.length >= 2 && s.chunks.length <= 16
    && s.chunks.every(chunk => typeof chunk === 'string' && [...chunk].length >= 1 && [...chunk].length <= 50 && !/[\r\n]/.test(chunk))
    && new Set(s.chunks).size === s.chunks.length && s.chunks.join('') === edit.text
    && [...edit.text].length <= 1024 && Number.isInteger(s.intervalMs) && s.intervalMs >= 10 && s.intervalMs <= 250;
}
export function checkInputProgress(edit, progress, complete = true) {
  const s = edit.inputSequence;
  if (!s) return progress === undefined;
  if (!progress || progress.editId !== edit.id || !Array.isArray(progress.chunks)
    || progress.chunks.length > s.chunks.length || (complete && progress.chunks.length !== s.chunks.length)) return false;
  let previous = -1;
  for (let index = 0; index < progress.chunks.length; index++) {
    const chunk = progress.chunks[index];
    if (!chunk || chunk.ordinal !== index + 1 || chunk.text !== s.chunks[index] || chunk.visible !== true
      || !Number.isFinite(chunk.elapsedMs) || chunk.elapsedMs < 0 || chunk.elapsedMs > INPUT_DEADLINE_MS
      || chunk.elapsedMs <= previous || (index > 0 && chunk.elapsedMs - previous < s.intervalMs)) return false;
    previous = chunk.elapsedMs;
  }
  if (progress.attemptedChunk !== undefined && (complete || progress.attemptedChunk.ordinal !== progress.chunks.length + 1
    || progress.attemptedChunk.text !== s.chunks[progress.chunks.length])) return false;
  return progress.acceptedPrefix === s.chunks.slice(0, progress.chunks.length).join('');
}
export async function typeInputSequence(edit, { insert, visible, now, sleep, progress }) {
  if (!validateInputSequence(edit)) throw new Error('invalid bounded input sequence');
  const start = now();
  for (const [index, text] of edit.inputSequence.chunks.entries()) {
    if (now() - start >= INPUT_DEADLINE_MS) throw new Error('input sequence deadline exceeded');
    progress.attemptedChunk = { ordinal: index + 1, text };
    await insert(text);
    while (!await visible(text)) {
      if (now() - start >= INPUT_DEADLINE_MS) throw new Error('input chunk not visible within deadline');
      await sleep(25);
    }
    const elapsedMs = now() - start;
    if (elapsedMs > INPUT_DEADLINE_MS) throw new Error('input sequence deadline exceeded');
    progress.chunks.push({ ordinal: index + 1, text, visible: true, elapsedMs });
    progress.acceptedPrefix += text;
    delete progress.attemptedChunk;
    if (index + 1 < edit.inputSequence.chunks.length) await sleep(edit.inputSequence.intervalMs);
  }
}
