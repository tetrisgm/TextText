/**
 * Tell a waiting reader that a write landed, instead of making it ask again.
 *
 * The relay holds a GET open and re-reads the append log on a timer. That
 * timer is the whole latency of co-editing: a word typed in one window waits,
 * on average, half a poll interval before the other window is even told to
 * look. At a 700ms first interval that is a median around 350ms of pure
 * waiting, which is what a person feels as the other cursor lagging behind.
 *
 * A writer and a reader of the same item are almost always talking to the
 * same server process, and that process already knows the write happened. So
 * it says so, and every reader holding that item wakes at once.
 *
 * This is an optimisation, never a source of truth:
 *
 *   NOTHING IS DELIVERED HERE. A wake means "go and look", and the reader
 *   still reads the log. A wake that turns out to be about nothing costs one
 *   query and the loop carries on.
 *
 *   THE TIMER REMAINS. Readers on another instance, or on another region, are
 *   never woken, so the poll stays exactly as it was and remains the floor. A
 *   deployment that grows to several instances gets slower, not wrong.
 *
 *   A WAKE IS NEVER MISSED IN A WAY THAT MATTERS. A write that lands between
 *   a reader's read and its wait is picked up by the next tick of that same
 *   timer, which is the behaviour the relay had before this existed.
 *
 * The production driver is Neon over HTTP, which has no connection to hold,
 * so Postgres LISTEN/NOTIFY is not available to do this across instances.
 */

type Waiter = () => void;

const waiting = new Map<string, Set<Waiter>>();

/** A write landed for this item. Wake everyone holding it open. */
export function announceCollabUpdate(postId: string): void {
  const group = waiting.get(postId);
  if (!group) return;
  // Copy first: each waiter removes itself as it runs.
  for (const wake of [...group]) {
    try {
      wake();
    } catch {
      // One waiter's teardown must not strand the others.
    }
  }
}

/**
 * Resolve when a write lands for this item, or when `ms` have passed,
 * whichever is first. The caller re-reads either way.
 */
export function waitForCollabUpdate(postId: string, ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const group = waiting.get(postId) ?? new Set<Waiter>();
    if (!waiting.has(postId)) waiting.set(postId, group);

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      group.delete(wake);
      if (group.size === 0) waiting.delete(postId);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const wake: Waiter = finish;
    const timer = setTimeout(finish, ms);

    group.add(wake);
    // A client that navigated away should not hold a slot until the timer.
    if (signal) {
      if (signal.aborted) finish();
      else signal.addEventListener("abort", finish, { once: true });
    }
  });
}

/** How many readers are being held open, for tests and for a health read. */
export function collabWaiterCount(postId?: string): number {
  if (postId) return waiting.get(postId)?.size ?? 0;
  let total = 0;
  for (const group of waiting.values()) total += group.size;
  return total;
}
