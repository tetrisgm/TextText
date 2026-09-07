import { readFileSync } from "node:fs";
import ts from "typescript";
import * as Y from "yjs";
import { afterEach, expect, it, vi } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { editorSaveLabel } from "@/components/document/EditorSaveNotice";
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
it("R12: a reachable server returning 503 must not be labeled offline", async () => {
  vi.useFakeTimers(); vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));
  const { CollabProvider } = await import("@/lib/collab/provider");
  const doc = new Y.Doc();
  const provider = new CollabProvider(doc, { postId: "round12-online-503", userName: "QA", color: "#000000", canPush: true, presence: false });
  try {
    const result = await provider.start();
    expect(result.authoritative).toBe(false);
    const source = readFileSync("src/components/document/UnifiedDocumentEditor.tsx", "utf8");
    const start = source.indexOf('      setSaveState(!result.authoritative');
    const end = source.indexOf(';', start) + 1;
    let state = "";
    new Function("result", "localMaterializationVersionRef", "savedMaterializationVersionRef", "setSaveState", source.slice(start, end))(
      result, { current: 0 }, { current: 0 }, (value: string) => { state = value; });
    expect(editorSaveLabel(state as Parameters<typeof editorSaveLabel>[0], true, true)).not.toBe("Offline");
  } finally { provider.destroy(); doc.destroy(); }
});
it.each(["subtitle", "fields"])("R12: look preview keeps a document containing only %s", field => {
  const document = emptyDocumentSnapshot();
  if (field === "subtitle") document.content.subtitle = "My actual subtitle";
  else document.content.fields = { project: "My actual project", status: "In progress" };
  const source = readFileSync("src/components/document/TemplateGallery.tsx", "utf8");
  const code = source.slice(source.indexOf("function isBlank("), source.indexOf("function inferredLibrary("));
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const isBlank = new Function(js + ";return isBlank;")();
  expect(isBlank(document), "meaningful content must not be replaced by the template example").toBe(false);
});
