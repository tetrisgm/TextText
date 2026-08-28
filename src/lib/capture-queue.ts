export const CAPTURE_RECEIPT_LIMIT = 6;

type CaptureQueueStatus =
  | "saving"
  | "saved"
  | "failed"
  | "deleting";

export type CaptureQueueEntry<Request, Artifact> = {
  createdAt: number;
  destination: string;
  error?: string;
  id: string;
  idempotencyKey: string;
  post?: Artifact;
  raw: string;
  request: Request;
  status: CaptureQueueStatus;
  title: string;
};

type CaptureStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageKey(blogId: string): string {
  return `texttext:capture-queue:${blogId}`;
}

function isCaptureQueueEntry(value: unknown): value is CaptureQueueEntry<unknown, unknown> {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.createdAt === "number" &&
    typeof entry.destination === "string" &&
    typeof entry.id === "string" &&
    typeof entry.idempotencyKey === "string" &&
    typeof entry.raw === "string" &&
    typeof entry.request === "object" &&
    entry.request !== null &&
    (entry.status === "saving" ||
      entry.status === "saved" ||
      entry.status === "failed" ||
      entry.status === "deleting") &&
    typeof entry.title === "string"
  );
}

/** Keep the newest receipts, including independent proof for a rapid burst. */
export function boundCaptureQueue<Request, Artifact>(
  entries: readonly CaptureQueueEntry<Request, Artifact>[],
): CaptureQueueEntry<Request, Artifact>[] {
  return entries
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, CAPTURE_RECEIPT_LIMIT);
}

export function enqueueCapture<Request, Artifact>(
  entries: readonly CaptureQueueEntry<Request, Artifact>[],
  entry: CaptureQueueEntry<Request, Artifact>,
): CaptureQueueEntry<Request, Artifact>[] {
  const current = entries.filter((candidate) => candidate.id !== entry.id);
  if (current.length < CAPTURE_RECEIPT_LIMIT) {
    return boundCaptureQueue([entry, ...current]);
  }

  // Only an already-saved receipt is safe to evict. If every slot represents
  // an unfinished or recoverable operation, reject the new envelope so the
  // composer can keep its input instead of silently throwing older input away.
  const ordered = boundCaptureQueue(current);
  const oldestSaved = ordered
    .slice()
    .reverse()
    .find((candidate) => candidate.status === "saved");
  if (!oldestSaved) return ordered;
  return boundCaptureQueue([
    entry,
    ...ordered.filter((candidate) => candidate.id !== oldestSaved.id),
  ]);
}

export function updateCapture<Request, Artifact>(
  entries: readonly CaptureQueueEntry<Request, Artifact>[],
  id: string,
  patch: Partial<CaptureQueueEntry<Request, Artifact>>,
): CaptureQueueEntry<Request, Artifact>[] {
  return entries.map((entry) =>
    entry.id === id ? { ...entry, ...patch, id: entry.id } : entry,
  );
}

export function removeCapture<Request, Artifact>(
  entries: readonly CaptureQueueEntry<Request, Artifact>[],
  id: string,
): CaptureQueueEntry<Request, Artifact>[] {
  return entries.filter((entry) => entry.id !== id);
}

/**
 * A browser can disappear between the command and its receipt. Keep the raw
 * input and idempotency key, then make the ambiguous operation explicitly
 * retryable after reload instead of guessing that it completed or discarding
 * what the person typed.
 */
export function recoverCaptureQueue<Request, Artifact>(
  entries: readonly CaptureQueueEntry<Request, Artifact>[],
): CaptureQueueEntry<Request, Artifact>[] {
  return entries.map((entry) => {
    if (entry.status === "saving") {
      return {
        ...entry,
        error: "Save was interrupted. Retry to finish it.",
        post: undefined,
        status: "failed",
      };
    }
    if (entry.status === "deleting") {
      return {
        ...entry,
        error: "Undo was interrupted. Try again.",
        status: "saved",
      };
    }
    return entry;
  });
}

export function readCaptureQueue<Request, Artifact>(
  storage: CaptureStorage,
  blogId: string,
): CaptureQueueEntry<Request, Artifact>[] {
  try {
    const raw = storage.getItem(storageKey(blogId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return boundCaptureQueue(
      parsed.filter(isCaptureQueueEntry) as CaptureQueueEntry<
        Request,
        Artifact
      >[],
    );
  } catch {
    return [];
  }
}

/** Synchronous by design: callers only clear the composer after this returns. */
export function writeCaptureQueue<Request, Artifact>(
  storage: CaptureStorage,
  blogId: string,
  entries: readonly CaptureQueueEntry<Request, Artifact>[],
): CaptureQueueEntry<Request, Artifact>[] {
  const bounded = boundCaptureQueue(entries);
  if (bounded.length === 0) storage.removeItem(storageKey(blogId));
  else storage.setItem(storageKey(blogId), JSON.stringify(bounded));
  return bounded;
}
