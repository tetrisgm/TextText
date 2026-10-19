/** Page lifetime ownership. Cross-process exclusion remains the adapter's job. */
export type SessionPhase = "opening" | "ready" | "reconnecting" | "draining" | "retained-error" | "closed";
export interface OwnedSession {
  start(): Promise<void>;
  setAttached(attached: boolean): void;
  save(): Promise<boolean>;
  close(): void | Promise<void>;
  readonly connected: boolean;
}
export type SessionHandle<T extends OwnedSession> = {
  readonly session: T;
  readonly lifecycle: string;
  readonly ready: Promise<void>;
  readonly phase: SessionPhase;
  release(): Promise<boolean>;
  /** Only the last view may explicitly reset an owner. Failure retains it. */
  closeExclusive(prepare?: () => void | Promise<void>): Promise<boolean>;
  runExclusive<R>(action: () => Promise<R>): Promise<R>;
};
type Entry<T extends OwnedSession> = { session: T; lifecycle: string; ready: Promise<void>; refs: number; revision: number; phase: SessionPhase; closing: boolean; operationBusy: boolean; drain?: Promise<boolean> };

export class SessionOwner<T extends OwnedSession> {
  private entries = new Map<string, Entry<T>>();
  get size() { return this.entries.size; }
  /** Application shutdown includes retained owners whose views already left. */
  async flushAll(): Promise<boolean> {
    const captured = [...this.entries.entries()];
    const revisions = new Map(captured.map(([, entry]) => [entry, entry.revision]));
    try {
      for (const [, entry] of captured) {
        if (entry.operationBusy) return false;
        await entry.ready.catch(() => {});
        if (entry.drain) await entry.drain;
        if (entry.phase === "closed") continue;
        if (!await entry.session.save()) return false;
      }
    } catch { return false; }
    for (const [key, entry] of this.entries) {
      if (entry.operationBusy || revisions.get(entry) !== entry.revision ||
          !captured.some(([priorKey, prior]) => priorKey === key && prior === entry)) return false;
    }
    return true;
  }
  acquire(key: string, create: () => T): SessionHandle<T> {
    let entry = this.entries.get(key);
    if (entry?.closing) throw new Error("This document is finishing a save. Try opening it again.");
    if (!entry) {
      const session = create();
      entry = { session, lifecycle: crypto.randomUUID(), ready: Promise.resolve(), refs: 0, revision: 0, phase: "opening", closing: false, operationBusy: false };
      this.entries.set(key, entry);
      const current = entry;
      current.ready = Promise.resolve().then(() => session.start()).then(() => {
        if (current.phase === "opening") current.phase = session.connected ? "ready" : "reconnecting";
      }, error => { current.phase = "retained-error"; throw error; });
      // A view may leave before open settles. Its release still awaits this.
      void current.ready.catch(() => {});
    }
    const current = entry;
    current.refs++; current.revision++; current.session.setAttached(true);
    if (current.phase === "draining") current.phase = current.session.connected ? "ready" : "reconnecting";
    let released = false;
    let operation: Promise<unknown> | null = null;
    let operationActive = false;
    const drain = async (exclusive: boolean, prepare?: () => void | Promise<void>): Promise<boolean> => {
      if (released) return true;
      if (exclusive && (current.refs !== 1 || (current.closing && !operationActive))) throw new Error("Close the other view of this document before reopening it.");
      if (exclusive) current.closing = true;
      else { released = true; current.refs--; }
      if (current.refs > (exclusive ? 1 : 0)) return true;
      const revision = ++current.revision;
      current.phase = "draining"; current.session.setAttached(false);
      const work = async () => {
        try {
          await current.ready.catch(() => {});
          // A previous drain may still be committing. Serialize saving and
          // final close, and fence its result against any reattached view.
          if (previous) await previous;
          if (current.revision !== revision) return false;
          if (!await current.session.save()) { if (current.revision === revision) current.phase = "retained-error"; return false; }
          if (current.revision !== revision) return false;
          current.closing = true;
          if (prepare) await prepare();
          await current.session.close();
          current.phase = "closed";
          if (!operationActive && this.entries.get(key) === current) this.entries.delete(key);
          if (exclusive) { released = true; current.refs--; }
          return true;
        } catch { if (current.revision === revision) current.phase = "retained-error"; return false; }
        finally {
          if (current.revision === revision && !operationActive) current.closing = false;
          if (exclusive && !released) current.session.setAttached(true);
        }
      };
      const previous = current.drain;
      const result = work(); current.drain = result;
      return result;
    };
    let releasing: Promise<boolean> | null = null;
    let exclusive: Promise<boolean> | null = null;
    return {
      session: current.session, lifecycle: current.lifecycle, ready: current.ready,
      get phase() { return ["ready", "reconnecting"].includes(current.phase) ? current.session.connected ? "ready" : "reconnecting" : current.phase; },
      release: () => releasing ??= operation ? operation.then(() => drain(false), () => drain(false)) : exclusive ? exclusive.then(done => done || drain(false), () => drain(false)) : drain(false),
      closeExclusive: prepare => exclusive ??= drain(true, prepare).finally(() => { exclusive = null; }),
      runExclusive: <R>(action: () => Promise<R>): Promise<R> => {
        if (released || current.refs !== 1 || current.closing || operationActive) return Promise.reject(new Error("Close the other view of this document before changing its file."));
        current.closing = true; operationActive = true; current.operationBusy = true;
        const result = Promise.resolve().then(action).finally(() => {
          operationActive = false; current.operationBusy = false; operation = null;
          if (current.phase === "closed" && this.entries.get(key) === current) this.entries.delete(key);
          current.closing = false;
        });
        operation = result;
        return result;
      },
    };
  }
}
