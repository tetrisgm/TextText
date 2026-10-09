import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot, validateDocumentSnapshot } from "@/lib/documents/model";
import {
  PROJECTION_BASELINE_ENTRY, coherentProjection, parseProjectionBaseline, readProjectionProvenance, sha256Hex, stampProjectionBaseline,
} from "@/lib/documents/projection-baseline";
import { encodePack, openPack } from "@/local-vault/pack";
import { writePayload } from "@/local-vault/model";
import { reconcileTextpacks } from "./pack-reconcile";
import coherenceFixture from "../../../sync/fixtures/projection-coherence.json";

const ID = "5f211864-df09-4bf6-9410-918c19dfb0eb";
const FOLDER = "Note.textbundle/";
const header = (title = "Title") => `---\ntextTextId: ${JSON.stringify(ID)}\ntitle: ${JSON.stringify(title)}\nexcerpt: ""\n---\n\n`;

/** A pack as a coherent writer emits it: JSON, its Markdown projection and the sidecar. */
function coherent(body: string, title = "Title") {
  const document = emptyDocumentSnapshot();
  document.content.body = body;
  document.content.title = title;
  return buildTextpack("Note", { document, markdown: header(title) + body });
}
/** The same pair without provenance: a pack from a writer that predates the sidecar. */
function legacy(body: string, title = "Title") {
  return change(coherent(body, title), { [PROJECTION_BASELINE_ENTRY]: null });
}
function change(bytes: Uint8Array, entries: Record<string, string | Uint8Array | null>) {
  const files = unzipSync(bytes);
  for (const [name, value] of Object.entries(entries)) {
    if (value === null) delete files[FOLDER + name];
    else files[FOLDER + name] = typeof value === "string" ? strToU8(value) : new Uint8Array(value);
  }
  return zipSync(files, { mtime: new Date(1980, 0, 1) });
}
const entry = (bytes: Uint8Array, name: string) => strFromU8(unzipSync(bytes)[FOLDER + name]);
const jsonBody = (bytes: Uint8Array) => JSON.parse(entry(bytes, "document.json")).content.body as string;
/** Markdown-only edit, as the CLI or an agent writes text.md behind the pack. */
const markdownOnly = (bytes: Uint8Array, body: string, title = "Title") => change(bytes, { "text.md": header(title) + body });
/** JSON-only edit, as an agent rewriting document.json without touching text.md. */
function jsonOnly(bytes: Uint8Array, body: string) {
  const document = JSON.parse(entry(bytes, "document.json"));
  document.content.body = body;
  return change(bytes, { "document.json": `${JSON.stringify(document, null, 2)}\n` });
}
function merged(result: ReturnType<typeof reconcileTextpacks>) {
  expect(result.status).toBe("merged");
  if (result.status !== "merged") throw new Error("Expected merge");
  return result.bytes;
}

describe("projection baseline sidecar", () => {
  it("hashes like SHA-256 (FIPS 180-4 vectors, and node:crypto across padding boundaries)", () => {
    // Known vectors pin the portable library itself; the browser bundle has no
    // node:crypto to compare against, so these are what the Mac and Windows
    // native digests must also produce.
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Hex("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    expect(sha256Hex(new Uint8Array([0xbd]))).toBe("68325720aabd7c82f30f554b313d0570c95accbb7dc4b5aae11204c08ffe732b");
    // Strings hash as UTF-8 bytes, and both input forms agree.
    expect(sha256Hex("Shared 🌍\n")).toBe(sha256Hex(strToU8("Shared 🌍\n")));
    for (let length = 0; length <= 140; length++) {
      const bytes = new Uint8Array(length).map((_, index) => (index * 37 + length) & 0xff);
      expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    const large = new Uint8Array(300_000).map((_, index) => (index * 7919) & 0xff);
    expect(sha256Hex(large)).toBe(createHash("sha256").update(large).digest("hex"));
  });

  it("agrees with the native stamp on which item-template pairs are coherent (shared fixture)", () => {
    // sync/fixtures/projection-coherence.json is also run by
    // TextTextProjectionBaselineTests.testSharedCoherenceFixture: real note,
    // article, bookmark, gallery and talk projections, and true frontmatter
    // conflicts, decided identically by both implementations.
    expect(coherenceFixture.length).toBeGreaterThan(10);
    for (const testCase of coherenceFixture) {
      const json = JSON.stringify(testCase.document);
      expect(coherentProjection(testCase.markdown, json) !== null, testCase.name).toBe(testCase.coherent);
      expect(stampProjectionBaseline(ID, testCase.markdown, json) !== null, testCase.name).toBe(testCase.coherent);
    }
  });

  it("is stamped by the shared builder and the vault writer only for coherent pairs", () => {
    const pack = coherent("one\ntwo");
    const baseline = parseProjectionBaseline(unzipSync(pack)[FOLDER + PROJECTION_BASELINE_ENTRY], ID);
    expect(baseline?.document.content.body).toBe("one\ntwo");
    expect(baseline?.markdownSha256).toBe(sha256Hex(entry(pack, "text.md")));
    expect(baseline?.documentSha256).toBe(sha256Hex(entry(pack, "document.json")));
    // A diverged pair is never stamped as coherent.
    expect(coherentProjection(header() + "other", entry(pack, "document.json"))).toBeNull();
    expect(stampProjectionBaseline(ID, header() + "other", entry(pack, "document.json"))).toBeNull();
    expect(stampProjectionBaseline("bad id", entry(pack, "text.md"), entry(pack, "document.json"))).toBeNull();
    // The vault writer's projection is coherent, so writePayload stamps it.
    const open = openPack(pack, "Note.textpack", "hash");
    const document = validateDocumentSnapshot(JSON.parse(open.file.documentJSON!));
    document.content.body = "one\ntwo\nthree";
    const payload = writePayload(open.file, document);
    expect(parseProjectionBaseline(payload.projectionJSON!, ID)?.document.content.body).toBe("one\ntwo\nthree");
    const written = openPack(encodePack(open, payload), "Note.textpack", "hash2");
    expect(parseProjectionBaseline(written.file.projectionJSON!, ID)?.documentSha256).toBe(sha256Hex(written.file.documentJSON!));
    // A Markdown-only rewrite keeps the earlier stamp, which still attributes the change.
    const appended = openPack(encodePack(written, { ...written.file, markdown: written.file.markdown + "\nCLI" }), "Note.textpack", "hash3");
    expect(appended.file.projectionJSON).toBe(written.file.projectionJSON);
    const provenance = readProjectionProvenance({
      itemId: ID, markdown: strToU8(appended.file.markdown), documentJSON: strToU8(appended.file.documentJSON!), baseline: strToU8(appended.file.projectionJSON!),
    });
    expect(provenance).toMatchObject({ markdownChanged: true, documentChanged: false });
  });

  it("rejects baselines of another item, another version or an invalid document", () => {
    const pack = coherent("one");
    const raw = JSON.parse(entry(pack, PROJECTION_BASELINE_ENTRY));
    expect(parseProjectionBaseline(JSON.stringify(raw), "other-item")).toBeNull();
    expect(parseProjectionBaseline(JSON.stringify({ ...raw, version: 2 }), ID)).toBeNull();
    expect(parseProjectionBaseline(JSON.stringify({ ...raw, document: { schemaVersion: 1 } }), ID)).toBeNull();
    expect(parseProjectionBaseline(JSON.stringify({ ...raw, markdownSha256: "short" }), ID)).toBeNull();
    expect(parseProjectionBaseline("not json", ID)).toBeNull();
  });
});

describe("reconciling packs with projection provenance", () => {
  const base = coherent("one");

  it("merges an offline app save followed by a Markdown append against the last cloud base", () => {
    const saved = coherent("one\nPC1\nPC2\nPC3");
    const local = markdownOnly(saved, "one\nPC1\nPC2\nPC3\nCLI");
    const result = merged(reconcileTextpacks(base, local, base));
    expect(jsonBody(result)).toBe("one\nPC1\nPC2\nPC3\nCLI");
    expect(entry(result, "text.md")).toContain("\nPC3\nCLI");
    // The merged pack is coherent and stamped for the next edit.
    expect(parseProjectionBaseline(entry(result, PROJECTION_BASELINE_ENTRY), ID)?.document.content.body).toBe("one\nPC1\nPC2\nPC3\nCLI");
  });

  it("keeps the same history when the local pack is the remote side", () => {
    const local = markdownOnly(coherent("one\nPC1\nPC2\nPC3"), "one\nPC1\nPC2\nPC3\nCLI");
    expect(jsonBody(merged(reconcileTextpacks(base, base, local)))).toBe("one\nPC1\nPC2\nPC3\nCLI");
  });

  it("keeps JSON-only edits and deletions after a Markdown save", () => {
    const saved = coherent("one\nPC1\nPC2\nPC3");
    expect(jsonBody(merged(reconcileTextpacks(base, jsonOnly(saved, "one\nPC1\nPC3"), base)))).toBe("one\nPC1\nPC3");
    expect(jsonBody(merged(reconcileTextpacks(base, jsonOnly(saved, "one\nPC1\nPC2\nPC3\nAGENT"), base)))).toBe("one\nPC1\nPC2\nPC3\nAGENT");
    // Deleting everything the app added is intentional, not a stale projection.
    expect(jsonBody(merged(reconcileTextpacks(base, jsonOnly(saved, "one"), base)))).toBe("one");
  });

  it("keeps Markdown-only deletions, including of the whole app save", () => {
    const saved = coherent("one\nPC1\nPC2\nPC3");
    expect(jsonBody(merged(reconcileTextpacks(base, markdownOnly(saved, "one\nPC1\nPC3"), base)))).toBe("one\nPC1\nPC3");
    expect(jsonBody(merged(reconcileTextpacks(base, markdownOnly(saved, "one"), base)))).toBe("one");
  });

  it("merges separate JSON and Markdown edits made after the same baseline", () => {
    const saved = coherent("one\ntwo\nthree");
    const local = jsonOnly(markdownOnly(saved, "one\ntwo\nthree\nCLI"), "ONE\ntwo\nthree");
    expect(jsonBody(merged(reconcileTextpacks(base, local, base)))).toBe("ONE\ntwo\nthree\nCLI");
  });

  it("refuses competing JSON and Markdown edits to the same text", () => {
    const saved = coherent("one\ntwo\nthree");
    const local = jsonOnly(markdownOnly(saved, "one\nMD\nthree"), "one\nJSON\nthree");
    expect(reconcileTextpacks(base, local, base)).toEqual({ status: "conflict", paths: ["/document/markdown"] });
  });

  it("never resolves a proved representation conflict against an unrelated cloud base", () => {
    // Adversarial: the branch's stamp proves text.md and document.json both
    // moved with competing edits to the same line. The cloud base happens to
    // carry the very same text.md, so the legacy comparison would have
    // accepted the branch's document.json unchanged and silently dropped the
    // Markdown edit. The proved conflict must win over that accident.
    const saved = coherent("one\ntwo\nthree");
    const branch = jsonOnly(markdownOnly(saved, "one\nMD\nthree"), "one\nJSON\nthree");
    const unrelatedBase = change(legacy("one\nMD\nthree"), { "text.md": entry(branch, "text.md") });
    expect(entry(unrelatedBase, "text.md")).toBe(entry(branch, "text.md"));
    expect(reconcileTextpacks(unrelatedBase, branch, unrelatedBase)).toEqual({ status: "conflict", paths: ["/document/markdown"] });
    expect(reconcileTextpacks(unrelatedBase, unrelatedBase, branch)).toEqual({ status: "conflict", paths: ["/document/markdown"] });
    // And a base whose document.json equals the branch's would otherwise have
    // let the Markdown side look like the only change.
    const baseLikeJSON = change(legacy("one\nJSON\nthree"), { "document.json": entry(branch, "document.json") });
    expect(reconcileTextpacks(baseLikeJSON, branch, baseLikeJSON)).toEqual({ status: "conflict", paths: ["/document/markdown"] });
    // A coherent pair is one document whatever an old stamp says.
    const coherentPair = change(legacy("one\nMD\nthree"), { [PROJECTION_BASELINE_ENTRY]: entry(saved, PROJECTION_BASELINE_ENTRY) });
    expect(jsonBody(merged(reconcileTextpacks(base, coherentPair, base)))).toBe("one\nMD\nthree");
  });

  it("does not resolve the sequential case for legacy packs without provenance", () => {
    // The intermediate app save is unknown, so the JSON and Markdown insertions
    // at the same position stay ambiguous: no chronology is invented.
    const local = markdownOnly(legacy("one\nPC1\nPC2\nPC3"), "one\nPC1\nPC2\nPC3\nCLI");
    expect(reconcileTextpacks(legacy("one"), local, legacy("one"))).toEqual({ status: "conflict", paths: ["/document/markdown"] });
    // Legacy Markdown-only and JSON-only edits still merge as before.
    expect(jsonBody(merged(reconcileTextpacks(legacy("one"), markdownOnly(legacy("one"), "one\nCLI"), legacy("one"))))).toBe("one\nCLI");
    expect(jsonBody(merged(reconcileTextpacks(legacy("one"), jsonOnly(legacy("one"), "one\nAGENT"), legacy("one"))))).toBe("one\nAGENT");
  });

  it("ignores a sidecar for another item or with an invalid document", () => {
    const saved = coherent("one\nPC1\nPC2\nPC3");
    const foreign = JSON.parse(entry(saved, PROJECTION_BASELINE_ENTRY));
    for (const sidecar of [{ ...foreign, itemId: "other" }, { ...foreign, version: 9 }, { ...foreign, document: null }]) {
      const local = markdownOnly(change(saved, { [PROJECTION_BASELINE_ENTRY]: JSON.stringify(sidecar) }), "one\nPC1\nPC2\nPC3\nCLI");
      expect(reconcileTextpacks(base, local, base)).toEqual({ status: "conflict", paths: ["/document/markdown"] });
    }
  });

  it("does not let a stale sidecar invent chronology once both entries left it", () => {
    // A writer without provenance support rewrote both entries after the stamp,
    // then the CLI appended. The stamp proves nothing about that rewrite, so the
    // same ambiguity as a legacy pack remains: a conflict, never a guess.
    const stamped = coherent("one\ntwo\nthree");
    const rewritten = change(legacy("one\ntwo\nthree\nfour"), { [PROJECTION_BASELINE_ENTRY]: entry(stamped, PROJECTION_BASELINE_ENTRY) });
    expect(reconcileTextpacks(base, markdownOnly(rewritten, "one\ntwo\nthree\nfour\nfive"), base)).toEqual({ status: "conflict", paths: ["/document/markdown"] });
    expect(reconcileTextpacks(base, markdownOnly(rewritten, "ONE\ntwo\nthree\nfour"), base)).toEqual({ status: "conflict", paths: ["/document/markdown"] });
    // A coherent rewrite that re-stamps restores attribution.
    expect(jsonBody(merged(reconcileTextpacks(base, markdownOnly(coherent("one\ntwo\nthree\nfour"), "one\ntwo\nthree\nfour\nfive"), base)))).toBe("one\ntwo\nthree\nfour\nfive");
  });

  it("merges a sequential local history with concurrent remote edits", () => {
    const local = markdownOnly(coherent("one\nPC1\nPC2\nPC3"), "one\nPC1\nPC2\nPC3\nCLI");
    const remote = coherent("MAC\none", "Renamed");
    const result = merged(reconcileTextpacks(base, local, remote));
    expect(jsonBody(result)).toBe("MAC\none\nPC1\nPC2\nPC3\nCLI");
    expect(JSON.parse(entry(result, "document.json")).content.title).toBe("Renamed");
    expect(entry(result, "text.md")).toContain('title: "Renamed"');
    // Remote text overlapping the local JSON edit stays a conflict.
    const shared = coherent("one\ntwo");
    const sequential = markdownOnly(jsonOnly(shared, "ONE\ntwo"), "one\ntwo\nCLI");
    expect(jsonBody(merged(reconcileTextpacks(shared, sequential, shared)))).toBe("ONE\ntwo\nCLI");
    expect(reconcileTextpacks(shared, sequential, coherent("1\ntwo")).status).toBe("conflict");
  });

  it("resolves the base through its own provenance so a folded append is not duplicated", () => {
    // The cloud stored a diverged pack: JSON "one", Markdown "one\nCLI", stamped at "one".
    const cloud = markdownOnly(coherent("one"), "one\nCLI");
    const local = coherent("one\nCLI\nmore");
    expect(jsonBody(merged(reconcileTextpacks(cloud, local, cloud)))).toBe("one\nCLI\nmore");
    expect(jsonBody(merged(reconcileTextpacks(cloud, local, coherent("one\nCLI"))))).toBe("one\nCLI\nmore");
  });

  it("preserves unknown entries and the sidecar is not merged as an opaque entry", () => {
    const withAsset = change(base, { "assets/a.bin": new Uint8Array([1]), "custom.json": "{}" });
    const local = markdownOnly(coherent("one\nPC"), "one\nPC\nCLI");
    const remote = change(coherent("MAC\none"), { "assets/a.bin": new Uint8Array([1]), "custom.json": "{}" });
    const files = unzipSync(merged(reconcileTextpacks(withAsset, change(local, { "assets/a.bin": new Uint8Array([1]), "custom.json": "{}" }), remote)));
    expect(files[FOLDER + "assets/a.bin"]).toEqual(new Uint8Array([1]));
    expect(strFromU8(files[FOLDER + "custom.json"])).toBe("{}");
  });
});

const SYNC = "/tmp/texttext-recover1236-sync.json";
describe.skipIf(!existsSync(SYNC))("client 1236 queued upload", () => {
  it("is a legacy pack whose history can only be attested, not inferred", () => {
    const outbox = JSON.parse(readFileSync(SYNC, "utf8")).Outbox[0];
    const queued = new Uint8Array(Buffer.from(outbox.Payload, "base64"));
    const files = unzipSync(queued);
    const prefix = Object.keys(files).find((name) => name.endsWith("document.json"))!.slice(0, -"document.json".length);
    expect(files[prefix + PROJECTION_BASELINE_ENTRY]).toBeUndefined();
    const document = validateDocumentSnapshot(JSON.parse(strFromU8(files[prefix + "document.json"])));
    const markdown = strFromU8(files[prefix + "text.md"]);
    // The Markdown extends the JSON body: the CLI append followed the app save.
    expect(markdown.endsWith(document.content.body) || markdown.includes(document.content.body)).toBe(true);
    // Reconstructing the baseline the app would have stamped resolves it; the
    // queued bytes themselves do not carry that attestation.
    const stamp = stampProjectionBaseline(ID, strToU8(markdown.replace(/\n---\n\n[\s\S]*$/, `\n---\n\n${document.content.body}`)), files[prefix + "document.json"]);
    expect(stamp).not.toBeNull();
  });
});
