import { describe, expect, it } from "vitest";
import { extractPDFText } from "../pdf-extraction.server";
import { pdfFixture } from "./pdf-fixture";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";

describe("real isolated PDF parsing", () => {
  it("preserves PDF bytes with bundler globals and exits cleanly after parsing", async () => {
    const worker = new Worker(resolve("src/lib/reading/pdf-extraction.worker.mjs"), {
      workerData: { bytes: pdfFixture("Bundled PDF bytes preserved"), __turbopack_globals__: {} },
      execArgv: [],
    });
    const message = new Promise(resolve => worker.once("message", resolve));
    const exit = new Promise<number>((resolve, reject) => {
      worker.once("exit", resolve); worker.once("error", reject);
    });
    try {
      expect(await message).toEqual({ markdown: "Bundled PDF bytes preserved" });
      expect(await exit).toBe(0);
    } finally { await worker.terminate(); }
  });
  it("extracts embedded text without converting literal PDF content to Markdown actions", async () => {
    const markdown = await extractPDFText(pdfFixture("A readable PDF. ![image](https://example.com/image) <script>literal</script>"));
    expect(markdown).toContain("A readable PDF.");
    expect(markdown).toContain("\\[image\\]");
    expect(markdown).toContain("\\<script\\>");
    expect(markdown).not.toContain("![image](");
  });
  it("reads pages in order and refuses a document exceeding its page budget", async () => {
    expect(await extractPDFText(pdfFixture("Two pages", 2))).toBe("Two pages\n\nTwo pages");
    await expect(extractPDFText(pdfFixture("Too many pages", 201))).rejects.toThrow(/could not be read/);
  });
  it("refuses image-only/empty and malformed documents, then accepts the next capture", async () => {
    await expect(extractPDFText(pdfFixture(""))).rejects.toThrow(/could not be read/);
    await expect(extractPDFText(new TextEncoder().encode("%PDF-broken"))).rejects.toThrow(/could not be read/);
    expect(await extractPDFText(pdfFixture("Still available"))).toBe("Still available");
  });
});
