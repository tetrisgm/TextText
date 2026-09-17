import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One answer per request for the questions a request asks over and over.
 *
 * A single Home load asked "which workspace is this handle" ten times and
 * "what folders does it have" four times, because the answer is needed by
 * every layer and no layer holds it. Against local Postgres that is invisible.
 * Against the production database each one is a fresh HTTPS request, so
 * twenty-six statements became a Home that took seconds.
 *
 * React's own `cache()` is the usual answer and is already applied to some of
 * these, but its scope only exists while a Server Component tree renders. The
 * reading surfaces are route handlers, where it does nothing, which is why the
 * repeats were there to find.
 *
 * The rule that keeps this safe is that a scope is opened around reads only.
 * Nothing inside one writes, so nothing inside one can read its own stale
 * answer. Outside a scope every call goes to the database exactly as before,
 * so a caller that does not opt in cannot be surprised by this file.
 */

const storage = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/**
 * Run a read for which repeated questions may share one answer. Never wrap a
 * write: a write followed by a read in the same scope would see what was true
 * before it.
 */
export function readScope<T>(run: () => Promise<T>): Promise<T> {
  // Nesting is harmless and deliberate: the inner run reuses the outer memo
  // rather than starting an emptier one.
  if (storage.getStore()) return run();
  return storage.run(new Map(), run);
}

/**
 * The value for `key`, computed at most once inside the current read. With no
 * read open, `load` runs every time, which is the behaviour every caller had
 * before this existed.
 */
export function onceInRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const memo = storage.getStore();
  if (!memo) return load();
  const existing = memo.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  // A rejected answer is forgotten, so a retry inside the same read is a real
  // retry and not the same failure served twice.
  const pending = load().catch((error) => {
    if (memo.get(key) === pending) memo.delete(key);
    throw error;
  });
  memo.set(key, pending);
  return pending;
}

/** True while a read scope is open. For assertions and tests. */
export function inReadScope(): boolean {
  return storage.getStore() !== undefined;
}
