/** Baselines exist only while queued writes or a debounced draft need them.
 * Completed files belong to reader state; retaining them here pins their assets
 * and can supersede a fresh read after navigation. */
export class ReaderWriteBaselines<T> {
  private readonly files = new Map<string, T>();
  get(path: string): T | undefined { return this.files.get(path); }
  set(path: string, file: T): void { this.files.set(path, file); }
  settled(pending: number, draftPath?: string): void {
    if (pending) return;
    for (const path of this.files.keys()) if (path !== draftPath) this.files.delete(path);
  }
  get size(): number { return this.files.size; }
}
