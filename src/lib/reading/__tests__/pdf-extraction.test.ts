import { describe, expect, it } from "vitest";
import { extractPDFText } from "../pdf-extraction.server";
import { pdfFixture } from "./pdf-fixture";

describe("real isolated PDF parsing", () => {
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
