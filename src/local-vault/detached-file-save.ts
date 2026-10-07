type FileIdentity = { path: string; hash: string };
type CleanJournalOwner = {
  readonly hasPendingChanges: boolean;
  readonly hasUnreadableJournal: boolean;
  discardCleanJournal(): void;
};

/** Evidence that a read-only editor has retired its clean journal after reading the saved file. */
export class DetachedFileSaveProof {
  private saved: FileIdentity | null = null;
  clear() { this.saved = null; }
  retire(client: CleanJournalOwner, file: FileIdentity) {
    this.clear();
    if (client.hasPendingChanges || client.hasUnreadableJournal || !file.path || !file.hash) {
      throw new Error("Pending collaboration history must be saved before leaving this file.");
    }
    // Ownership and journal removal failures remain close blockers.
    client.discardCleanJournal();
    this.saved = { path: file.path, hash: file.hash };
  }
  matches(file: FileIdentity) {
    return this.saved !== null && this.saved.path === file.path && this.saved.hash === file.hash;
  }
}
