import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { externalBodyEdits, reconcileDocumentSnapshots } from "./reconcile";

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

  it("keeps a CLI append after an active replacement of the final sentence", () => {
    const { base, local, remote } = replicas("Existing fixture text.");
    local.content.body = "[mac-app r1 delta81]";
    remote.content.body = "Existing fixture text.[mac-cli r1 echo843]";
    expect(reconcileDocumentSnapshots(base, local, remote, { concurrentInsertions: "remote-first" })).toMatchObject({
      status: "merged", document: { content: { body: "[mac-app r1 delta81][mac-cli r1 echo843]" } },
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

  describe("remote-first fallback for several separate edits", () => {
    const remoteFirst = { concurrentInsertions: "remote-first" as const };
    function merged(body: string, left: string, right: string): string | undefined {
      const { base, local, remote } = replicas(body);
      local.content.body = left;
      remote.content.body = right;
      const result = reconcileDocumentSnapshots(base, local, remote, remoteFirst);
      return result.status === "merged" ? result.document.content.body : undefined;
    }

    it("keeps a pending append when the server prepended and appended", () => {
      const body = " [pc-app:00] [pc-app:01] [pc-app:02]";
      const pending = " [pc-app:03] [pc-app:04] [pc-app:05]";
      for (const serverAppend of [" [pc-cli]", " [pc-cli]."]) {
        const result = merged(body, body + pending, "other actors" + body + serverAppend);
        expect(result).toBe("other actors" + body + serverAppend + pending);
        expect(result?.match(/\[pc-[a-z]+(:\d+)?\]/g)).toHaveLength(7);
      }
    });

    it("interleaves separated replacements from both sides", () => {
      expect(merged("one two three four", "ONE two three FOUR", "one TWO three four"))
        .toBe("ONE TWO three FOUR");
    });

    it("keeps both exact same-span replacements in stable order", () => {
      const { base, local, remote } = replicas("before old after");
      local.content.body = "before human after";
      remote.content.body = "before agent after";
      expect(reconcileDocumentSnapshots(base, local, remote, {
        concurrentInsertions: "remote-first", preserveOverlappingReplacement: true,
      })).toMatchObject({ status: "merged", document: { content: { body: "before agenthuman after" } } });
      expect(reconcileDocumentSnapshots(base, local, remote, remoteFirst).status).toBe("conflict");
    });

    it("keeps both replacements when the editor also removes the final newline", () => {
      const { base, local, remote } = replicas("Existing fixture text.\n");
      local.content.body = "[pc-app]";
      remote.content.body = "[pc-cli]\n";
      expect(reconcileDocumentSnapshots(base, local, remote, {
        concurrentInsertions: "remote-first", preserveOverlappingReplacement: true,
      })).toMatchObject({ status: "merged", document: { content: { body: "[pc-cli][pc-app]\n" } } });
    });

    it("keeps both partial replacements and projects the external change onto the live text", () => {
      for (const [body, left, right, expected] of [
        ["abcdefgh", "abLfgh", "abcdRh", "abRLh"],
        ["abcdefgh", "abcdLh", "abRfgh", "abRLh"],
        ["abcdefgh", "abfgh", "abcdRh", "abRh"],
        ["abcdefgh", "abLfgh", "abcdh", "abLh"],
        ["abcdefgh", "abfgh", "abcdh", "abh"],
      ]) {
        const { base, local, remote } = replicas(body);
        local.content.body = left;
        remote.content.body = right;
        expect(reconcileDocumentSnapshots(base, local, remote, {
          concurrentInsertions: "remote-first", preserveOverlappingReplacement: true,
        })).toMatchObject({ status: "merged", document: { content: { body: expected } } });
        const projected = externalBodyEdits(body, left, right, expected);
        expect(projected).toBeDefined();
        expect(projected?.reduce((text, edit) => text.slice(0, edit.start) + edit.replacement + text.slice(edit.end), left))
          .toBe(expected);
      }
    });

    it("retains the file's terminal newline across a partial overlap", () => {
      const body = "Existing fixture text.\n", left = "[human]", right = "Existing [agent]\n";
      const { base, local, remote } = replicas(body);
      local.content.body = left;
      remote.content.body = right;
      const expected = "[agent][human]\n";
      expect(reconcileDocumentSnapshots(base, local, remote, {
        concurrentInsertions: "remote-first", preserveOverlappingReplacement: true,
      })).toMatchObject({ status: "merged", document: { content: { body: expected } } });
      const projected = externalBodyEdits(body, left, right, expected);
      expect(projected?.reduce((text, edit) => text.slice(0, edit.start) + edit.replacement + text.slice(edit.end), left))
        .toBe(expected);
    });

    it("retains a partial file edit beside several live replacements", () => {
      const body = "Existing fixture text.\n";
      const left = "[pc-web][mac-web][mac-app][mac-cli]";
      const right = "Existing [pc-cli]\n";
      const { base, local, remote } = replicas(body);
      local.content.body = left;
      remote.content.body = right;
      const result = reconcileDocumentSnapshots(base, local, remote, {
        concurrentInsertions: "remote-first", preserveOverlappingReplacement: true,
      });
      expect(result.status).toBe("merged");
      if (result.status !== "merged") return;
      expect(result.document.content.body).toContain("[pc-cli]");
      for (const marker of ["[pc-web]", "[mac-web]", "[mac-app]", "[mac-cli]"]) {
        expect(result.document.content.body).toContain(marker);
      }
      const projected = externalBodyEdits(body, left, right, result.document.content.body);
      expect(projected?.reduce((text, edit) => text.slice(0, edit.start) + edit.replacement + text.slice(edit.end), left))
        .toBe(result.document.content.body);
    });

    it("keeps a partial file replacement beside one live replacement with incidental matching letters", () => {
      const body = "Existing fixture text.\n";
      const left = "[pc-app r1 yankee912]";
      const right = "Existing [pc-cli r1 lima215]\n";
      const { base, local, remote } = replicas(body);
      local.content.body = left;
      remote.content.body = right;
      const result = reconcileDocumentSnapshots(base, local, remote, {
        concurrentInsertions: "remote-first", preserveOverlappingReplacement: true,
      });
      expect(result).toMatchObject({ status: "merged", document: { content: { body: "[pc-cli r1 lima215][pc-app r1 yankee912]\n" } } });
      if (result.status !== "merged") return;
      const projected = externalBodyEdits(body, left, right, result.document.content.body);
      expect(projected?.reduce((text, edit) => text.slice(0, edit.start) + edit.replacement + text.slice(edit.end), left))
        .toBe(result.document.content.body);
    });

    it("preserves unchanged text inside a multi-edit overlap", () => {
      const { base, local, remote } = replicas("abcdefgh");
      local.content.body = "aXcdYfgh";
      remote.content.body = "abcQefgh";
      expect(reconcileDocumentSnapshots(base, local, remote, {
        concurrentInsertions: "remote-first", preserveOverlappingReplacement: true,
      })).toMatchObject({ status: "merged", document: { content: { body: "aXcQYfgh" } } });
    });

    it("orders coincident insertions remote-first next to other local edits", () => {
      expect(merged("ab cd", "aXb cdL", "aYb cd")).toBe("aYXb cdL");
    });

    it("applies identical sub-edits once", () => {
      expect(merged("one two three", "ONE two three!", "ONE TWO three")).toBe("ONE TWO three!");
    });

    it("still refuses overlapping replacements and boundary insertions", () => {
      for (const [body, left, right] of [
        ["abcdef", "abXYef", "abcZef"],
        ["abcdef", "abXYef", "abcdQef"],
        ["abcdef", "abcdQef", "abXYef"],
      ]) {
        const { base, local, remote } = replicas(body);
        local.content.body = left;
        remote.content.body = right;
        expect(reconcileDocumentSnapshots(base, local, remote, remoteFirst))
          .toEqual({ status: "conflict", paths: ["/content/body"], base, local, remote });
      }
    });

    it("keeps emoji intact across prepend, append and pending append", () => {
      const body = "😀 a 😀";
      expect(merged(body, body + " 😎", "🙂 " + body + " 🎉")).toBe("🙂 " + body + " 🎉 😎");
    });

    it("refuses the fallback beyond its span and edit-distance bounds", () => {
      const wide = "x".repeat(25_000);
      expect(merged(wide, wide + "L", "R" + wide + "R")).toBeUndefined();
      const narrow = "x".repeat(100);
      expect(merged(narrow, narrow + "L", "y".repeat(3_000) + narrow + "R")).toBeUndefined();
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
