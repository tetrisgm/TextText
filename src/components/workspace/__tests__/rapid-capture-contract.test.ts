import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const folderPage = readFileSync(
  new URL("../UniversalItemComposer.tsx", import.meta.url),
  "utf8",
);
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
const poolStore = readFileSync(
  new URL("../../../lib/pool/store.ts", import.meta.url),
  "utf8",
);

describe("rapid capture contract", () => {
  it("turns the Library composer into an in-place TextText inbox", () => {
    expect(folderPage).toContain("Save a thought, note, link, or AI answer");
    expect(folderPage).toContain('candidate.mode === (sourceUrl ? "bookmarks" : "notes")');
    expect(folderPage).toContain("onPersisted: (savedPost, receipt)");
    expect(folderPage).toContain("onFailed: (captureError)");
    expect(folderPage).toContain("Saving to ${capture.destination}");
    expect(folderPage).toContain("Saved to ${capture.destination}");
    expect(folderPage).toContain('capture.status === "failed"');
    // Receipts are for FAILURES only (owner, 2026-09-04): a save that worked
    // has already put the item in the list below, and its receipt was
    // clutter. A failure leaves no other trace, so that one still shows.
    expect(folderPage).toContain("failedCaptures.map((capture)");
    expect(folderPage).toContain(
      'captures.filter((capture) => capture.status === "failed")',
    );
    expect(folderPage).toContain("readCaptureQueue<FolderCreateRequest, Post>");
    expect(folderPage).toContain("writeCaptureQueue(");
    expect(folderPage).toContain("before the textarea is ever cleared");
    expect(folderPage).toContain("Retry");
    expect(folderPage).toContain("View unsaved text for ${capture.title}");
    expect(folderPage).toContain("Copy unsaved text for ${capture.title}");
    expect(folderPage).toContain("Discard unsaved capture ${capture.title}");
    expect(folderPage).toContain("window.confirm(");
    expect(folderPage).toContain("onOpenCapturedItem(capture.post!)");
    expect(folderPage).toContain("await onDeleteItem(capture.post)");
    expect(folderPage).toContain("Could not undo capture");
  });

  it("keeps intentional folder creation as create-and-open", () => {
    expect(folderPage).toContain("Create something in this folder");
    expect(folderPage).toContain("A folder already supplies intent");
  });

  it("uses the shared idempotent command before acknowledging an inbox capture", () => {
    expect(workspaceShell).toContain("if (options?.open !== false)");
    expect(workspaceShell).toContain("return postFromPoolPost(temp)");
    expect(workspaceShell).toContain("itemIdentity.resolvePost(pool, postId)");
    expect(workspaceShell).toContain('"create_item"');
    expect(workspaceShell).toContain("capture: options.capture");
    expect(workspaceShell).toContain("options.idempotencyKey");
    expect(workspaceShell).toContain("await refreshWorkspacePool");
    expect(workspaceShell).toContain("A refresh that was already in flight");
    expect(workspaceShell).toContain(
      "options.onPersisted?.(postFromPoolPost(savedPoolPost), {",
    );
    expect(workspaceShell).toContain("receiptItemId !== savedId");
    expect(workspaceShell).toContain("savedTo: receiptSavedTo");
    expect(workspaceShell).toContain("options?.onPersisted?.(postFromPoolPost(merged))");
    expect(workspaceShell).toContain("attempt >= 3");
    expect(workspaceShell).toContain("options.onFailed?.(error)");
    expect(folderPage).toContain("idempotencyKey: crypto.randomUUID()");
    expect(folderPage).toContain("idempotencyKey: capture.idempotencyKey");
  });

  it("makes C focus the Library inbox instead of opening a blank item", () => {
    expect(folderPage).toContain("focusRequestKey");
    expect(folderPage).toContain("inputRef.current?.focus()");
    expect(workspaceShell).toContain(
      'current.level === "root" || current.level === "search"',
    );
    expect(workspaceShell).toContain("setCaptureFocusRequestKey");
  });

  it("keeps the first Library frame identical during hydration", () => {
    expect(workspaceShell).toContain("useState<WorkspaceDocumentOpenHistory>(\n    {},\n  )");
    expect(workspaceShell).toContain("const hydrate = window.setTimeout");
    expect(workspaceShell).toContain("const { pool } = useWorkspacePool(initialPool)");
    expect(workspaceShell).toContain("poolHydrated && pool?.blogId === initialPool.blogId");
    expect(poolStore).toContain("export function useWorkspacePool(initialPool?");
    expect(poolStore).toContain("initialServerSnapshot ?? getServerSnapshot()");
  });

  it("does not overwrite a persisted capture before its queue hydrates", () => {
    expect(folderPage).toContain("hydratedCaptureQueueHandle");
    expect(folderPage).toContain(
      "hydratedCaptureQueueHandle === handle",
    );
    expect(folderPage).toContain("setHydratedCaptureQueueHandle(handle)");
    expect(folderPage).toContain("capturesInPlace && !captureQueueReady");
    expect(folderPage).toContain("Your text is still here");
  });

  it("uses item-specific accessible receipt actions", () => {
    for (const label of [
      "Open ${capture.title}",
      "Retry saving ${capture.title}",
      "View unsaved text for ${capture.title}",
      "Copy unsaved text for ${capture.title}",
      "Discard unsaved capture ${capture.title}",
      "Undo saving ${capture.title}",
    ]) {
      expect(folderPage).toContain(label);
    }
  });
});
