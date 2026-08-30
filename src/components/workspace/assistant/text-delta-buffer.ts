export type AssistantTextDeltaBuffer = {
  push: (text: string) => void;
  flush: () => void;
  finish: () => void;
  cancel: () => void;
};

/** Coalesces provider-sized text fragments into human-visible streaming frames.
 * The caller owns the first chunk so a response still appears immediately. */
export function createAssistantTextDeltaBuffer(
  onFlush: (text: string) => void,
  delayMs = 50,
): AssistantTextDeltaBuffer {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const flush = () => {
    clearTimer();
    if (!pending) return;
    const text = pending;
    pending = "";
    onFlush(text);
  };

  return {
    push(text) {
      if (closed || !text) return;
      pending += text;
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    flush,
    finish() {
      if (closed) return;
      flush();
      closed = true;
    },
    cancel() {
      clearTimer();
      pending = "";
      closed = true;
    },
  };
}
