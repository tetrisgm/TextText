import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import * as Y from "yjs";
import { applyDocumentBaseline, documentText } from "@/lib/collab/document";
import { capturePreReadyDocumentBaseline, preReadyTextOperations } from "@/lib/collab/pre-ready";
import { validateDocumentSnapshot } from "@/lib/documents/model";

const workspaceShell = [
  "../../PostWorkspaceShell.tsx",
  "../WorkspaceSidebarChrome.tsx",
  "../WorkspaceRootPages.tsx",
  "../WorkspaceSpecialPages.tsx",
  "../WorkspaceItemViews.tsx",
  // The editor moved into its own module so it can be loaded on demand;
  // these contracts follow it.
  "../WorkspaceItemEditor.tsx",
  "../../../lib/workspace/local-view.ts",
  "../../../lib/workspace/draft-sessions.ts",
]
  .map((p) => readFileSync(new URL(p, import.meta.url), "utf8"))
  .join("\n");

describe("canonical workspace document guard", () => {
  it("never treats a failed document request as an empty editor baseline", () => {
    expect(workspaceShell).toContain(
      'return documentState.entry.status === "error"',
    );
    expect(workspaceShell).not.toContain(
      'bodyState.entry.status === "error"',
    );
    expect(workspaceShell).toContain(
      "documentState.entry.document.document",
    );
  });

  it("updates and acknowledges the complete canonical document", () => {
    expect(workspaceShell).toContain(
      "updatePostDocument(pool.blogId, poolPost.id, nextDocument)",
    );
    expect(workspaceShell).toContain("acknowledgePostDocument(");
    expect(workspaceShell).toContain("nextDocument,\n        revision,");
  });
});


// Execute the production body/revision selection block, not a duplicate selector.
function selectedEditorPost(cachedRevision: number | null) {
  const source = readFileSync(new URL("../WorkspaceItemEditor.tsx", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("  const initialDocument ="), source.indexOf("  const containingFolderPath ="));
  const snapshot = (body: string) => validateDocumentSnapshot({
    schemaVersion: 1, content: { title: "Title", body, fields: {}, tags: [], assets: [] },
    presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
  });
  const current = { postId: "item", revision: 8, document: snapshot("abc") };
  const cached = cachedRevision === null ? null : { ...current, revision: cachedRevision, document: snapshot("old") };
  const bindings = {
    pool: { blogId: "blog", initialDocuments: cachedRevision === null ? [] : [current] },
    poolPost: { id: "item" },
    useWorkspacePostDocument: () => ({ entry: { status: "ready", document: current }, load() {} }),
    getCachedWorkspacePostDocument: () => cachedRevision === null ? current : cached,
    useClientHydrated: () => true,
    useEffect: () => {},
    postFromPoolPost: () => ({ id: "item" }),
  };
  const js = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const post = new Function(...Object.keys(bindings), js + "; return post;")(...Object.values(bindings)) as {
    revision: number; document: ReturnType<typeof snapshot>;
  };
  return { post, current };
}

it("round7: the selected server body carries its own revision despite an older cached body", () => {
  const { post, current } = selectedEditorPost(7);
  expect(post.document).toEqual(current.document);
  expect(post.revision).toBe(8);
});

it("round7: a stale cache cannot send an ordinary startup deletion into identity recovery", () => {
  const { post, current } = selectedEditorPost(7);
  const baseline = capturePreReadyDocumentBaseline(post.document, `item:${post.revision}`);
  const doc = new Y.Doc();
  try {
    applyDocumentBaseline(doc, current.document, "item:8");
    const target = documentText(doc, "body");
    expect(() => preReadyTextOperations("abc", "ac", target.toString(), {
      baseline: baseline.body, target,
    })).not.toThrow();
  } finally { doc.destroy(); }
});

it("round7: first body fetch populating an empty cache supplies the fetched revision", () => {
  const { post, current } = selectedEditorPost(null);
  expect(post).toMatchObject({ revision: 8, document: current.document });
});
