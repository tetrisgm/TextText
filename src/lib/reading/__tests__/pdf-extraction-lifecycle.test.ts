import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const workers = vi.hoisted(() => [] as Array<EventEmitter & { terminate: ReturnType<typeof vi.fn> }>);
vi.mock("node:worker_threads", () => ({ Worker: class extends EventEmitter {
  terminate = vi.fn(async () => 0);
  constructor() { super(); workers.push(this); }
} }));
import { extractPDFText, MAX_CAPTURE_PDF_BYTES } from "../pdf-extraction.server";
const bytes = new TextEncoder().encode("%PDF-1.4");
afterEach(() => { workers.length = 0; vi.useRealTimers(); });

describe("PDF resource lifecycle", () => {
  it("rejects invalid bytes, oversized inputs and pre-canceled work before starting a parser", async () => {
    await expect(extractPDFText(new Uint8Array(MAX_CAPTURE_PDF_BYTES + 1))).rejects.toThrow(/could not be read/);
    await expect(extractPDFText(new Uint8Array())).rejects.toThrow(/could not be read/);
    await expect(extractPDFText(bytes, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(workers).toHaveLength(0);
  });
  it("bounds concurrency and releases slots after normal completion", async () => {
    const first = extractPDFText(bytes); const second = extractPDFText(bytes);
    await expect(extractPDFText(bytes)).rejects.toThrow(/busy/);
    workers[0].emit("message", { markdown: "First" }); workers[1].emit("message", { markdown: "Second" });
    expect(await Promise.all([first, second])).toEqual(["First", "Second"]);
    const next = extractPDFText(bytes); workers[2].emit("message", { markdown: "Next" });
    expect(await next).toBe("Next");
    expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
  it("terminates canceled parsing and removes its abort listener", async () => {
    const controller = new AbortController(); const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = extractPDFText(bytes, controller.signal); controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it("enforces the hard deadline even if the parser never responds", async () => {
    vi.useFakeTimers(); const result = extractPDFText(bytes);
    const rejected = expect(result).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(8_000); await rejected;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const next = extractPDFText(bytes); workers[1].emit("message", { markdown: "After deadline" });
    expect(await next).toBe("After deadline");
  });
  it("does not expose parser errors or accept invalid/oversized output", async () => {
    for (const event of ["error", "exit", "message"]) {
      const result = extractPDFText(bytes);
      workers.at(-1)!.emit(event, event === "error" ? new Error("private PDF text") : event === "exit" ? 1 : { markdown: "x".repeat(2_000_001) });
      await expect(result).rejects.toThrow("This PDF could not be read. Open the original PDF instead.");
      expect(workers.at(-1)!.terminate).toHaveBeenCalledOnce();
    }
  });
});
