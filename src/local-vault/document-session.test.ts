import { describe, expect, it, vi } from "vitest";
import { VaultDocumentSession } from "./document-session";
import type { VaultFile } from "./bridge";

const itemId = "item-1";
const before: VaultFile = {
  path: "Notes/Shared.textpack", hash: "before",
  markdown: `---\ntextTextId: "${itemId}"\ntitle: "Shared"\n---\n\nOriginal`,
};

describe("external file observation during shared editing", () => {
  it("joins a changed file through the live document merge before a checkpoint conflict", async () => {
    const session = new VaultDocumentSession({ namespace: "https://texttext.test", workspaceId: "workspace", itemId, localFiles: true }, before);
    const fresh: VaultFile = { ...before, hash: "after", markdown: before.markdown.replace("Original", "Agent edit") };
    const reconcileExternalDocument = vi.fn(() => true), notifyExternalFileChange = vi.fn();
    Reflect.set(session, "shared", { hasBaseline: true, status: "ready", reconcileExternalDocument, notifyExternalFileChange });
    Reflect.set(session, "request", vi.fn(async () => fresh));
    Reflect.set(session, "attached", true);
    Reflect.set(session, "queued", true);
    await Reflect.get(session, "checkFile").call(session);
    expect(reconcileExternalDocument).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.objectContaining({ body: "Original" }) }),
      expect.objectContaining({ content: expect.objectContaining({ body: "Agent edit" }) }),
    );
    expect(session.file.hash).toBe("after");
    expect(notifyExternalFileChange).not.toHaveBeenCalled();
  });
  it("keeps the recovery path when the changed file cannot be joined", async () => {
    const session = new VaultDocumentSession({ namespace: "https://texttext.test", workspaceId: "workspace", itemId, localFiles: true }, before);
    const fresh: VaultFile = { ...before, hash: "after", markdown: before.markdown.replace("Original", "Agent edit") };
    const notifyExternalFileChange = vi.fn();
    Reflect.set(session, "shared", { hasBaseline: true, status: "ready", reconcileExternalDocument: vi.fn(() => false), notifyExternalFileChange });
    Reflect.set(session, "request", vi.fn(async () => fresh));
    Reflect.set(session, "attached", true);
    Reflect.set(session, "queued", true);
    await Reflect.get(session, "checkFile").call(session);
    expect(session.file.hash).toBe("before");
    expect(notifyExternalFileChange).toHaveBeenCalledOnce();
  });
});
