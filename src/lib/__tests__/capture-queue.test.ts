import { describe, expect, it } from "vitest";
import {
  CAPTURE_RECEIPT_LIMIT,
  boundCaptureQueue,
  enqueueCapture,
  readCaptureQueue,
  recoverCaptureQueue,
  removeCapture,
  updateCapture,
  writeCaptureQueue,
} from "@/lib/capture-queue";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

type Request = { type: "note"; body: string };
type Artifact = { id: string; title: string };

function capture(
  id: string,
  createdAt: number,
  status: "saving" | "saved" | "failed" | "deleting" = "saving",
) {
  return {
    createdAt,
    destination: "Notes",
    id,
    idempotencyKey: `key-${id}`,
    raw: `raw-${id}`,
    request: { type: "note", body: `body-${id}` } as Request,
    status,
    title: `title-${id}`,
  };
}

describe("durable capture receipt queue", () => {
  it("retains independent ordered proof for a rapid burst", () => {
    let queue: ReturnType<typeof capture>[] = [];
    queue = enqueueCapture(queue, capture("first", 1));
    queue = enqueueCapture(queue, capture("second", 2));
    queue = enqueueCapture(queue, capture("third", 3));

    expect(queue.map((entry) => entry.id)).toEqual([
      "third",
      "second",
      "first",
    ]);
    expect(queue.map((entry) => entry.idempotencyKey)).toEqual([
      "key-third",
      "key-second",
      "key-first",
    ]);
  });

  it("bounds old receipts without collapsing the receipts inside the window", () => {
    const captures = Array.from(
      { length: CAPTURE_RECEIPT_LIMIT + 3 },
      (_, index) => capture(`capture-${index}`, index),
    );

    const bounded = boundCaptureQueue(captures);
    expect(bounded).toHaveLength(CAPTURE_RECEIPT_LIMIT);
    expect(bounded[0]?.id).toBe(`capture-${CAPTURE_RECEIPT_LIMIT + 2}`);
    expect(bounded.at(-1)?.id).toBe("capture-3");
  });

  it("never evicts unfinished input to make room for another capture", () => {
    const pending = Array.from(
      { length: CAPTURE_RECEIPT_LIMIT },
      (_, index) => capture(`pending-${index}`, index),
    );
    const rejected = enqueueCapture(pending, capture("new", 100));
    expect(rejected.map((entry) => entry.id)).not.toContain("new");
    expect(rejected).toHaveLength(CAPTURE_RECEIPT_LIMIT);

    const withSavedSlot = [
      { ...pending[0]!, status: "saved" as const },
      ...pending.slice(1),
    ];
    const accepted = enqueueCapture(withSavedSlot, capture("new", 100));
    expect(accepted.map((entry) => entry.id)).toContain("new");
    expect(accepted.map((entry) => entry.id)).not.toContain("pending-0");
    expect(accepted).toHaveLength(CAPTURE_RECEIPT_LIMIT);
  });

  it("round-trips the raw input and stable retry key before acknowledgement", () => {
    const storage = new MemoryStorage();
    const queued = [capture("pending", 10)];
    writeCaptureQueue(storage, "blog-1", queued);

    const restored = readCaptureQueue<Request, Artifact>(storage, "blog-1");
    expect(restored).toMatchObject([
      {
        id: "pending",
        idempotencyKey: "key-pending",
        raw: "raw-pending",
        request: { body: "body-pending" },
        status: "saving",
      },
    ]);
  });

  it("surfaces a durability failure synchronously to the composer", () => {
    const storage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(() =>
      writeCaptureQueue(storage, "blog-1", [capture("pending", 10)]),
    ).toThrow("storage unavailable");
  });

  it("makes ambiguous save and undo operations retryable after reload", () => {
    const saving = capture("save", 2, "saving");
    const deleting = {
      ...capture("delete", 1, "deleting"),
      post: { id: "post-1", title: "Saved" },
    };

    const recovered = recoverCaptureQueue([saving, deleting]);
    expect(recovered[0]).toMatchObject({
      id: "save",
      idempotencyKey: "key-save",
      raw: "raw-save",
      status: "failed",
      error: "Save was interrupted. Retry to finish it.",
    });
    expect(recovered[1]).toMatchObject({
      id: "delete",
      post: { id: "post-1" },
      status: "saved",
      error: "Undo was interrupted. Try again.",
    });
  });

  it("updates and removes only the receipt whose server action settled", () => {
    const queue = [capture("second", 2), capture("first", 1)];
    const saved = updateCapture<Request, Artifact>(queue, "first", {
      post: { id: "post-1", title: "First" },
      status: "saved",
    });

    expect(saved[0]?.status).toBe("saving");
    expect(saved[1]).toMatchObject({
      id: "first",
      idempotencyKey: "key-first",
      post: { id: "post-1" },
      status: "saved",
    });
    expect(removeCapture(saved, "first").map((entry) => entry.id)).toEqual([
      "second",
    ]);
  });
});
