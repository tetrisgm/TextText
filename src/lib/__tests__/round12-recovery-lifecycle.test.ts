import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as Y from "yjs";
import { afterEach, expect, it, vi } from "vitest";
import { applyDocumentSnapshot, documentSnapshotFromYDoc, hasDocumentSnapshot } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { keepMaterializationRecovery, readMaterializationRecoveries, acknowledgeMaterializationRecoveries, recoveryHeading, type MaterializationRecovery } from "@/lib/collab/materialization-recovery";
import { outboxIndexedDB } from "./helpers/outbox-indexeddb";

const source = readFileSync("src/components/document/UnifiedDocumentEditor.tsx", "utf8");
function execute(code: string, bindings: Record<string, unknown>) {
  return new Function(...Object.keys(bindings), ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText)(...Object.values(bindings));
}
function button(node: React.ReactNode, label: string): React.ReactElement<{ onClick: () => unknown; children: React.ReactNode }> | undefined {
  if (!React.isValidElement<{ onClick: () => unknown; children: React.ReactNode }>(node)) return;
  if (node.type === "button" && node.props.children === label) return node;
  for (const child of React.Children.toArray(node.props.children)) {
    const found = button(child, label); if (found) return found;
  }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it.each([true, false])("delayed discovery exports both copies, reports ledger durability %s and survives acknowledgment/remount", async writable => {
  vi.useFakeTimers();
  const storage = outboxIndexedDB(); vi.stubGlobal("indexedDB", storage.indexedDB);
  const records = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return records.size; }, key: (index: number) => [...records.keys()][index],
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { if (!writable) throw new Error("Full"); records.set(key, value); },
    removeItem: (key: string) => records.delete(key),
  });
  const postId = "ledger-lifecycle", doc = new Y.Doc(), old = emptyDocumentSnapshot();
  old.content.body = "Older quarantined text"; applyDocumentSnapshot(doc, old);
  const oldCopy: MaterializationRecovery = { id: "retired-copy", outboxKey: "retired:ledger-lifecycle:old", postId, epoch: 1,
    reason: "sync-rejected", state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"), document: old };
  storage.records.set(oldCopy.outboxKey!, { postId: oldCopy.outboxKey!, documentPostId: postId, copy: oldCopy });
  let copies: MaterializationRecovery[] = [], durable = true, downloaded = false;
  const preReadyLocalRef = { current: null as ReturnType<typeof emptyDocumentSnapshot> | null };
  const recoveryBlockedRef = { current: false };
  const setRecoveryCopies = (next: typeof copies | ((previous: typeof copies) => typeof copies)) => { copies = typeof next === "function" ? next(copies) : next; };
  const setRecoveryDurable = (next: boolean | ((previous: boolean) => boolean)) => { durable = typeof next === "function" ? next(durable) : next; };
  const bindings = { useCallback: (fn: unknown) => fn, recoveryBlockedRef, preReadyLocalRef,
    documentRef: { current: old }, collab: { postId }, doc, Y, hasDocumentSnapshot, documentSnapshotFromYDoc,
    bytesToBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
    keepMaterializationRecovery, recoveryHeading, setRecoveryCopies, setRecoveryDurable, setSaveState: vi.fn(), setError: vi.fn() };
  const preserveStart = source.indexOf("  const preserveRecovery = useCallback(");
  const preserveRecovery = execute(source.slice(preserveStart, source.indexOf("  const materializeTimerRef", preserveStart)) + "\nreturn preserveRecovery;", bindings);
  const callbackStart = source.indexOf("      onRecovery: (copies, durable) => {");
  const bodyStart = source.indexOf("{", callbackStart) + 1;
  const body = source.slice(bodyStart, source.indexOf("\n      },", bodyStart));
  const providerModule = await import("@/lib/collab/provider");
  const provider = new providerModule.CollabProvider(doc, { postId, userName: "QA", color: "#000000", canPush: true, presence: false,
    onRecovery: (incoming, saved) => execute(body, { ...bindings, copies: incoming, durable: saved, cancelled: false, preserveRecovery }),
  });
  const ready = provider.start();
  // Discovery is still awaiting IndexedDB. This ledger has not entered the CRDT.
  const ledger = emptyDocumentSnapshot(); ledger.content.body = "New text before readiness";
  ledger.content.subtitle = "Local subtitle"; ledger.content.fields = { count: 0, done: false };
  preReadyLocalRef.current = ledger;
  await ready;
  try {
    expect(copies.map(copy => copy.document?.content.body)).toEqual([ledger.content.body, old.content.body]);
    expect(durable).toBe(writable);
    expect(recoveryBlockedRef.current).toBe(true);
    if (writable) {
      expect(readMaterializationRecoveries(postId)[0].document).toEqual(ledger);
      expect((await providerModule.readDocumentRecoveries(postId)).copies).toHaveLength(2);
    }
    let download: Blob | undefined;
    const reload = vi.fn(), click = vi.fn();
    vi.stubGlobal("window", { document: { createElement: () => ({ click }) }, location: { reload } });
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { download = blob as Blob; return "blob:recovery"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const recoveryStart = source.indexOf("  if (recoveryCopies.length)");
    const render = () => execute(source.slice(recoveryStart, source.indexOf("  if (baselineFailure &&", recoveryStart)), {
      React, recoveryCopies: copies, recoveryDurable: durable, accessLoss: null, recoveryHeading, recoveryDownloaded: downloaded,
      collab: { postId }, recoveryError: null, setRecoveryError: vi.fn(), setRecoveryDownloaded: (value: boolean) => { downloaded = value; },
      acknowledgeRetiredOutboxes: providerModule.acknowledgeRetiredOutboxes, acknowledgeMaterializationRecoveries,
    });
    const html = renderToStaticMarkup(render());
    expect(html).toContain(writable ? "Your local copy is kept on this device." : "Device storage is unavailable.");
    expect(html).not.toContain("none of your text is lost");
    button(render(), "Download local copy")!.props.onClick();
    expect(JSON.parse(await download!.text())).toEqual(copies);
    expect(click).toHaveBeenCalledOnce();
    await button(render(), "Open current version")!.props.onClick();
    expect(reload).toHaveBeenCalledOnce();
    expect((await providerModule.readDocumentRecoveries(postId)).copies).toEqual([]);
  } finally { provider.destroy(); doc.destroy(); vi.restoreAllMocks(); }
});
