import { Worker } from "node:worker_threads";
import { resolve } from "node:path";

export const MAX_CAPTURE_PDF_BYTES = 8_000_000;
const MAX_PDF_WORKERS = 2;
let activeWorkers = 0;

/** Hard parsing deadline and JS heap ceiling protect collaboration on Oracle.
 * No queue holds requests open when both parsing slots are already occupied. */
export async function extractPDFText(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException("Request canceled", "AbortError");
  if (bytes.byteLength > MAX_CAPTURE_PDF_BYTES || Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error("This PDF could not be read. Open the original PDF instead.");
  }
  if (activeWorkers >= MAX_PDF_WORKERS) throw new Error("PDF capture is busy. Your link is saved; try again shortly.");
  const worker = new Worker(resolve(process.cwd(), "src/lib/reading/pdf-extraction.worker.mjs"), {
    workerData: bytes,
    env: {}, execArgv: [], stdout: true, stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
  });
  // Parser diagnostics are not user content logs. Drain without recording them.
  worker.stdout?.resume(); worker.stderr?.resume();
  activeWorkers++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<string>((accept, reject) => {
      abort = () => reject(new DOMException("Request canceled", "AbortError"));
      timer = setTimeout(() => reject(new Error("This PDF took too long to read. Open the original PDF instead.")), 8_000);
      signal?.addEventListener("abort", abort, { once: true });
      worker.once("message", (result: unknown) => {
        if (result && typeof result === "object" && "markdown" in result &&
            typeof result.markdown === "string" && result.markdown.trim() && result.markdown.length <= 2_000_000) accept(result.markdown);
        else reject(new Error("This PDF could not be read. Open the original PDF instead."));
      });
      worker.once("error", () => reject(new Error("This PDF could not be read. Open the original PDF instead.")));
      worker.once("exit", () => reject(new Error("This PDF could not be read. Open the original PDF instead.")));
      if (signal?.aborted) abort();
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
    try { await worker.terminate(); } finally { activeWorkers--; }
  }
}
