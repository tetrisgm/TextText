import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { reconcileDocumentSnapshots } from "./reconcile";

function replicas(body = "one\ntwo\nthree\n") {
  const base = emptyDocumentSnapshot();
  base.content.body = body;
  return { base, local: structuredClone(base), remote: structuredClone(base) };
}

describe("reconcileDocumentSnapshots", () => {
  it("accepts one changed replica and converges identical edits", () => {
    const { base, local, remote } = replicas();
    local.content.title = "Changed";
    expect(reconcileDocumentSnapshots(base, local, remote)).toEqual({ status: "merged", document: local });
    expect(reconcileDocumentSnapshots(base, local, local)).toEqual({ status: "merged", document: local });
  });

  it("merges independent metadata and body edits without mutating inputs", () => {
    const { base, local, remote } = replicas();
    local.content.body = "ONE\ntwo\nthree\n";
    remote.content.body = "one\ntwo\nTHREE\n";
    local.content.fields.author = "A";
    remote.content.fields.reviewed = true;
    remote.content.title = "Review";
    const originals = structuredClone({ base, local, remote });
    const result = reconcileDocumentSnapshots(base, local, remote);
    expect(result.status).toBe("merged");
    if (result.status !== "merged") throw new Error("Expected merge");
    expect(result.document.content).toMatchObject({
      body: "ONE\ntwo\nTHREE\n", title: "Review", fields: { author: "A", reviewed: true },
    });
    expect({ base, local, remote }).toEqual(originals);
    expect(reconcileDocumentSnapshots(base, remote, local)).toEqual(result);
  });

  it("merges separated insertion and deletion", () => {
    const { base, local, remote } = replicas("abcdef");
    local.content.body = "abef";
    remote.content.body = "abcdef!";
    expect(reconcileDocumentSnapshots(base, local, remote)).toMatchObject({
      status: "merged", document: { content: { body: "abef!" } },
    });
  });

  it("preserves both bodies when replacements overlap or inserts share a position", () => {
    for (const [body, left, right] of [["abcdef", "abXYef", "abcZef"], ["ab", "aXb", "aYb"]]) {
      const { base, local, remote } = replicas(body);
      local.content.body = left;
      remote.content.body = right;
      const result = reconcileDocumentSnapshots(base, local, remote);
      expect(result).toEqual({ status: "conflict", paths: ["/content/body"], base, local, remote });
      expect(result).not.toHaveProperty("document");
    }
  });

  it("preserves edits when another replica deletes a field", () => {
    const { base, local, remote } = replicas();
    base.content.fields.summary = "original";
    remote.content.fields.summary = "edited";
    expect(reconcileDocumentSnapshots(base, local, remote)).toMatchObject({
      status: "conflict", paths: ["/content/fields/summary"],
    });
    remote.content.fields.summary = "original";
    expect(reconcileDocumentSnapshots(base, local, remote)).toMatchObject({
      status: "merged", document: { content: { fields: {} } },
    });
  });

  it("reports all conflicts and treats arrays and pinned templates atomically", () => {
    const { base, local, remote } = replicas();
    local.content.tags = ["local"];
    remote.content.tags = ["remote"];
    local.presentation.template.id = "new-look";
    remote.presentation.template.version = 2;
    local.content.fields.newField = "a";
    remote.content.fields.newField = "b";
    expect(reconcileDocumentSnapshots(base, local, remote)).toMatchObject({
      status: "conflict",
      paths: ["/content/fields/newField", "/content/tags", "/presentation/template"],
    });
  });

  it("merges distant emoji edits without splitting surrogate pairs", () => {
    const { base, local, remote } = replicas("😀 hello 😀");
    local.content.body = "😁 hello 😀";
    remote.content.body = "😀 hello 😎";
    expect(reconcileDocumentSnapshots(base, local, remote)).toMatchObject({
      status: "merged", document: { content: { body: "😁 hello 😎" } },
    });
  });

  it("handles a large body with distant changes in bounded linear work", () => {
    const { base, local, remote } = replicas("start" + "x".repeat(1_000_000) + "end");
    local.content.body = "START" + "x".repeat(1_000_000) + "end";
    remote.content.body = "start" + "x".repeat(1_000_000) + "END";
    expect(reconcileDocumentSnapshots(base, local, remote)).toMatchObject({
      status: "merged", document: { content: { body: "START" + "x".repeat(1_000_000) + "END" } },
    });
  });

  it("does not mistake object key order for a change", () => {
    const { base, local, remote } = replicas();
    base.content.fields = { a: "1", b: "2" };
    local.content.fields = { b: "2", a: "1" };
    remote.content.fields = { a: "changed", b: "2" };
    expect(reconcileDocumentSnapshots(base, local, remote)).toEqual({ status: "merged", document: remote });
  });
});
