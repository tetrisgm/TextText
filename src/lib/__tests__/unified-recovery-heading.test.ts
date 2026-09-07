import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as Y from "yjs";
import { afterEach, expect, it, vi } from "vitest";
import { applyDocumentSnapshot, documentSnapshotFromYDoc, hasDocumentSnapshot } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import {
  keepMaterializationRecovery, readMaterializationRecoveries, recoveryHeading,
  type MaterializationRecovery, type RecoveryReason,
} from "@/lib/collab/materialization-recovery";

// Execute the editor's real recovery callback and render its real recovery
// branch. This tests the displayed JSX without claiming a mounted browser test.
const source = readFileSync(new URL("../../components/document/UnifiedDocumentEditor.tsx", import.meta.url), "utf8");
function execute(code: string, bindings: Record<string, unknown>) {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
}
function renderRecovery(copies: MaterializationRecovery[], durable: boolean, accessLoss: string | null = null) {
  const start = source.indexOf("  if (recoveryCopies.length)");
  const end = source.indexOf("  if (baselineFailure &&", start);
  return renderToStaticMarkup(execute(source.slice(start, end), {
    React, recoveryCopies: copies, recoveryDurable: durable, accessLoss,
    recoveryHeading, recoveryDownloaded: false, collab: { postId: "post" },
    // The shared editor error can still hold an earlier message naming a cause
    // this recovery did not have, so the screen must not repeat it. Only
    // failures raised on the recovery screen itself may be shown.
    error: "This document changed elsewhere. Local edits were kept for recovery.",
    recoveryError: null,
  }));
}
afterEach(() => vi.unstubAllGlobals());

it.each([
  ["sync-rejected", "These edits could not be synced"],
  ["outbox-conflict", "Your local edits need recovery"],
  ["document-changed", "This document changed elsewhere"],
  [undefined, "Your local edits need recovery"],
] as const)("renders truthful recovery copy for %s, including after reopening", (reason, heading) => {
  const records = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return records.size; },
    key: (index: number) => [...records.keys()][index],
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
  });
  const doc = new Y.Doc(), snapshot = emptyDocumentSnapshot();
  snapshot.content.body = "Local edits";
  applyDocumentSnapshot(doc, snapshot);
  const setRecoveryCopies = vi.fn(), setRecoveryDurable = vi.fn(), setError = vi.fn();
  const start = source.indexOf("  const preserveRecovery = useCallback(");
  const end = source.indexOf("  const materializeTimerRef", start);
  const preserve = execute(source.slice(start, end) + "\nreturn preserveRecovery;", {
    useCallback: (fn: unknown) => fn,
    recoveryBlockedRef: { current: false }, preReadyLocalRef: { current: null },
    documentRef: { current: snapshot }, collab: { postId: "post" },
    doc, Y, hasDocumentSnapshot, documentSnapshotFromYDoc,
    bytesToBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
    keepMaterializationRecovery, recoveryHeading, setRecoveryCopies, setRecoveryDurable,
    setSaveState: vi.fn(), setError,
  }) as (epoch: number, reason?: RecoveryReason) => void;
  try {
    preserve(5, reason);
    expect(setError).toHaveBeenCalledWith(`${heading}. Download your local copy before reopening.`);
    expect(setRecoveryDurable).toHaveBeenCalledWith(true);
    const copies = setRecoveryCopies.mock.calls[0][0] as MaterializationRecovery[];
    expect(copies[0].document).toEqual(snapshot);
    for (const saved of [copies, readMaterializationRecoveries("post")]) {
      const html = renderRecovery(saved, true);
      expect(html).toContain(`<h1>${heading}</h1>`);
      expect(html).toContain("Your local copy is kept on this device.");
      expect(html).toContain("Download local copy");
      expect(html).toContain('disabled=""');
      if (reason !== "document-changed") expect(html).not.toContain("changed elsewhere");
    }
    expect(renderRecovery(copies, false)).toContain("Device storage is unavailable.");
    expect(renderRecovery(copies, true, "You no longer have access to this document"))
      .toContain("<h1>You no longer have access to this document</h1>");
  } finally { doc.destroy(); }
});
