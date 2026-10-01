import { describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { emptyDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import type { ArticleCapture } from "@/lib/vault/article-capture";
import { VaultError, type VaultFile, type VaultTransport } from "./bridge";
import { enrichArticleFile, queueArticleEnrichment, readArticleEnrichmentQueue,
  removeArticleEnrichment, runArticleEnrichmentTick } from "./article-enrichment";
import { readDocument, writePayload } from "./model";
import { emptyPack, encodePack, openPack } from "./pack";

const sourceURL = "https://example.com/article";
const image = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const capture: ArticleCapture = {
  sourceURL,
  markdown: "# Captured\n\n![Hero](https://cdn.example.com/hero.png)\n\nSource text.",
  capturedAt: "2026-10-01T12:00:00Z",
  media: [{ filename: "article-hero.png", contentType: "image/png", data: Buffer.from(image).toString("base64"),
    remoteURL: "https://cdn.example.com/hero.png" }],
};

function saved(document: DocumentSnapshot, path = "Reading/Saved.textpack", hash = "r1"): VaultFile {
  const seed: VaultFile = { path, hash, markdown: `---\ntextTextId: "saved-id"\n---\n\n` };
  return { ...seed, ...writePayload(seed, document) };
}

function pending(): DocumentSnapshot {
  const document = emptyDocumentSnapshot({ id: "texttext.bookmark", version: 1 });
  document.content.title = "Saved link";
  document.content.body = sourceURL;
  document.content.fields = { sourceUrl: sourceURL, captureStatus: "pending", commentary: "Keep this" };
  return document;
}

describe("unopened article enrichment", () => {
  it("stores exact article media bytes and source metadata inside the same TextPack", () => {
    const file = saved(pending());
    const pack = emptyPack();
    pack.entries[pack.prefix + "info.json"] = strToU8(JSON.stringify({ version: 2, opaque: { keep: true }, "net.texttext.assets": {} }));
    const addition = { ...capture.media![0], data: image };
    const first = encodePack(pack, file, [addition]);
    const entries = unzipSync(first);
    expect(entries[pack.prefix + "assets/article-hero.png"]).toEqual(image);
    const info = JSON.parse(strFromU8(entries[pack.prefix + "info.json"]));
    expect(info.opaque).toEqual({ keep: true });
    expect(info["net.texttext.assets"]["article-hero.png"]).toMatchObject({
      url: "https://cdn.example.com/hero.png", contentType: "image/png",
    });

    const opened = openPack(first, file.path, "r2");
    const retry = encodePack(opened, opened.file, [addition]);
    expect(Object.keys(unzipSync(retry)).filter((name) => name.endsWith("/assets/article-hero.png"))).toHaveLength(1);
    expect(() => encodePack(opened, opened.file, [{ ...addition, data: Uint8Array.from([...image, 9]) }])).toThrow(/already uses/);
  });

  it("progresses an unopened link from the bounded durable creation queue without folder scans", async () => {
    let file = saved(pending());
    const writes: Record<string, unknown>[] = [];
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const request = vi.fn<VaultTransport>(async (method, params) => {
      if (method === "read") return structuredClone(file);
      if (method === "extractArticle") return capture;
      if (method === "write") {
        writes.push(params);
        file = { ...file, ...params, hash: "r2" } as VaultFile;
        return structuredClone(file);
      }
      throw new Error(`Unexpected ${method}`);
    });

    queueArticleEnrichment("vault:test", file.path, storage);
    expect(readArticleEnrichmentQueue("vault:test", storage)).toEqual([file.path]);
    const result = await runArticleEnrichmentTick(readArticleEnrichmentQueue("vault:test", storage), request);
    expect(result).toMatchObject({ path: file.path, outcome: "written", scanned: 1 });
    expect(request).toHaveBeenCalledWith("extractArticle", { sourceURL }, undefined);
    expect(request).not.toHaveBeenCalledWith("preview", expect.anything(), expect.anything());
    expect(readDocument(file).content.fields).toMatchObject({ captureStatus: "complete", captureMediaStatus: "complete" });
    expect(writes[0].addedAssets).toEqual(capture.media);
    removeArticleEnrichment("vault:test", file.path, storage);
    expect(readArticleEnrichmentQueue("vault:test", storage)).toEqual([]);
  });

  it("retries a revision conflict once, preserves the intervening edit, and remains idempotent", async () => {
    let file = saved(pending());
    let conflict = true;
    const writes: Record<string, unknown>[] = [];
    const request: VaultTransport = async (method, params) => {
      if (method === "read") return structuredClone(file);
      if (method === "extractArticle") return capture;
      if (method === "write") {
        writes.push(params);
        if (conflict) {
          conflict = false;
          const edited = readDocument(file);
          edited.content.body = "Manual edit made during extraction.";
          file = { ...file, ...writePayload(file, edited), hash: "r2" };
          throw new VaultError("changed", "conflict", structuredClone(file));
        }
        file = { ...file, ...params, hash: "r3" } as VaultFile;
        return structuredClone(file);
      }
      throw new Error(`Unexpected ${method}`);
    };

    await expect(enrichArticleFile(file.path, request)).resolves.toBe("written");
    const document = readDocument(file);
    expect(document.content.body).toBe("Manual edit made during extraction.");
    expect(document.content.fields).toMatchObject({ commentary: "Keep this", capturedSourceBody: expect.stringContaining("assets/article-hero.png") });
    expect(writes).toHaveLength(2);
    expect(writes[1].addedAssets).toEqual([{ ...capture.media![0], data: Buffer.from(image).toString("base64") }]);

    await expect(enrichArticleFile(file.path, request)).resolves.toBe("skipped");
    expect(writes).toHaveLength(2);
  });
});
