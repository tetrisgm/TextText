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

afterEach(() => vi.unstubAllGlobals());
it("R12: discovering a retired outbox includes text typed before readiness in the recovery download", () => {
  const ledger = emptyDocumentSnapshot(); ledger.content.body = "NEW TEXT TYPED WHILE RECOVERY LOADS";
  const old = emptyDocumentSnapshot(); old.content.body = "Older quarantined edits";
  const existing: MaterializationRecovery = { id: "old", outboxKey: "retired:post:old", postId: "post", epoch: 1, reason: "sync-rejected", state: "", document: old };
  const doc = new Y.Doc(); applyDocumentSnapshot(doc, old);
  existing.state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  const records = new Map<string, string>();
  vi.stubGlobal("localStorage", { setItem: (key: string, value: string) => records.set(key, value) });
  const recoveryBlockedRef = { current: false }, preReadyLocalRef = { current: ledger };
  let recoveryCopies: MaterializationRecovery[] = [];
  const setRecoveryCopies = (value: MaterializationRecovery[] | ((previous: MaterializationRecovery[]) => MaterializationRecovery[])) => {
    recoveryCopies = typeof value === "function" ? value(recoveryCopies) : value;
  };
  const start = source.indexOf("  const preserveRecovery = useCallback(");
  const end = source.indexOf("  const materializeTimerRef", start);
  const preserveRecovery = execute(source.slice(start, end) + "\nreturn preserveRecovery;", {
    useCallback: (fn: unknown) => fn, recoveryBlockedRef, preReadyLocalRef,
    documentRef: { current: ledger }, collab: { postId: "post" }, doc, Y,
    hasDocumentSnapshot, documentSnapshotFromYDoc,
    bytesToBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
    keepMaterializationRecovery, recoveryHeading, setRecoveryCopies,
    setRecoveryDurable: vi.fn(), setSaveState: vi.fn(), setError: vi.fn(),
  }) as (epoch: number) => void;
  const callbackStart = source.indexOf("      onRecovery: (copies, durable) => {");
  const bodyStart = source.indexOf("{", callbackStart) + 1;
  const bodyEnd = source.indexOf("\n      },", bodyStart);
  try {
    execute(source.slice(bodyStart, bodyEnd), {
      copies: [existing], durable: true, recoveryBlockedRef, cancelled: false,
      setRecoveryCopies, setRecoveryDurable: vi.fn(), setSaveState: vi.fn(),
      preReadyLocalRef, preserveRecovery,
    });
    // Same fallback as effect cleanup. It currently returns at the blocked guard.
    preserveRecovery(1);
    expect(JSON.stringify({ download: recoveryCopies, durableFallback: [...records.values()] }))
      .toContain(ledger.content.body);
  } finally { doc.destroy(); }
});
