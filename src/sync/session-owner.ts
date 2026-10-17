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
};
type Entry<T extends OwnedSession> = { session: T; lifecycle: string; ready: Promise<void>; refs: number; revision: number; phase: SessionPhase; closing: boolean; drain?: Promise<boolean> };

export class SessionOwner<T extends OwnedSession> {
  private entries = new Map<string, Entry<T>>();
  get size() { return this.entries.size; }
  acquire(key: string, create: () => T): SessionHandle<T> {
    let entry = this.entries.get(key);
    if (entry?.closing) throw new Error("This document is finishing a save. Try opening it again.");
    if (!entry) {
      const session = create();
      entry = { session, lifecycle: crypto.randomUUID(), ready: Promise.resolve(), refs: 0, revision: 0, phase: "opening", closing: false };
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
    const drain = async (exclusive: boolean, prepare?: () => void | Promise<void>): Promise<boolean> => {
      if (released) return true;
      if (exclusive && (current.refs !== 1 || current.closing)) throw new Error("Close the other view of this document before reopening it.");
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
          if (this.entries.get(key) === current) this.entries.delete(key);
          if (exclusive) { released = true; current.refs--; }
          return true;
        } catch { if (current.revision === revision) current.phase = "retained-error"; return false; }
        finally {
          if (current.revision === revision) current.closing = false;
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
      get phase() { return current.phase; },
      release: () => releasing ??= exclusive ? exclusive.then(done => done || drain(false), () => drain(false)) : drain(false),
      closeExclusive: prepare => exclusive ??= drain(true, prepare).finally(() => { exclusive = null; }),
    };
  }
}
