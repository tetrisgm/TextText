import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { decodeHandoffUpdate, encodeHandoffUpdate, handoffUpdateSha256, parseNativeHandoffDraft, persistNativeHandoffDraft, preserveLegacyHandoffDraft, type NativeHandoffDraft, NativeHandoffDraftOwner } from "./native-handoff-draft";
const scope = { origin: "https://texttext.app", accountId: "account", workspaceId: "workspace", itemId: "item", epoch: 1 };
function fixture(): NativeHandoffDraft { const document = emptyDocumentSnapshot({ id: "texttext.note", version: 1 }); return { version: 2, generation: 2, base: document, document, look: null, handoff: { version: 1, scope, legacyDraftSha256: null, intents: [{ id: "b38f9046-58cc-43bc-bdf5-e7e1006ef288", sourceGeneration: 1, sourceDocument: document, update: encodeHandoffUpdate(Y.encodeStateAsUpdate(new Y.Doc())), updateSha256: handoffUpdateSha256(Y.encodeStateAsUpdate(new Y.Doc())) }] } }; }
describe("native-only durable handoff draft codec", () => {
  it("round-trips exact intent bytes and complete draft", () => { const draft = fixture(); expect(parseNativeHandoffDraft(JSON.stringify(draft), scope)).toEqual(draft); expect(encodeHandoffUpdate(decodeHandoffUpdate(draft.handoff.intents[0].update))).toBe(draft.handoff.intents[0].update); });
  it.each(["origin", "accountId", "workspaceId", "itemId", "epoch"] as const)("refuses changed %s without rewriting retained bytes", field => { const draft = fixture(), raw = JSON.stringify(draft); expect(() => parseNativeHandoffDraft(raw, { ...scope, [field]: field === "epoch" ? 2 : "other" })).toThrow(); expect(JSON.stringify(draft)).toBe(raw); });
  it("refuses unknown fields, future versions and a third transfer", () => { const draft = fixture(); for (const value of [{ ...draft, version: 3 }, { ...draft, extra: true }, { ...draft, handoff: { ...draft.handoff, intents: Array(3).fill(draft.handoff.intents[0]) } }]) expect(() => parseNativeHandoffDraft(JSON.stringify(value), scope)).toThrow(); });
  it("refuses invalid encodings, duplicate IDs and future local generations", () => { for (const change of [{ update: "not base64" }, { update: "!!!!" }, { sourceGeneration: 3 }]) { const draft = fixture(); Object.assign(draft.handoff.intents[0], change); expect(() => parseNativeHandoffDraft(JSON.stringify(draft), scope)).toThrow(); } const draft = fixture(); draft.handoff.intents.push(draft.handoff.intents[0]); expect(() => parseNativeHandoffDraft(JSON.stringify(draft), scope)).toThrow(); });
  it("does not authorize applying an update after quota or round-trip failure", () => { const draft = fixture(); expect(() => persistNativeHandoffDraft({ setItem() { throw Error("quota"); }, getItem() { return null; } }, "draft", draft)).toThrow("quota"); expect(() => persistNativeHandoffDraft({ setItem() {}, getItem() { return "old"; } }, "draft", draft)).toThrow("verified"); });
  it("preserves legacy bytes create-only and refuses another retained draft", () => {
    const values = new Map([["draft", "legacy exact bytes"]]);
    const storage = { getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { values.set(key, value); } };
    preserveLegacyHandoffDraft(storage, "draft", "legacy exact bytes");
    expect([...values.entries()].find(([key]) => key.startsWith("draft:before-handoff-v2:"))?.[1]).toBe("legacy exact bytes");
    values.set("draft", "new draft");
    preserveLegacyHandoffDraft(storage, "draft", "new draft");
    expect([...values.keys()].filter(key => key.startsWith("draft:before-handoff-v2:"))).toHaveLength(2);
    const backup = [...values.keys()].find(key => key.startsWith("draft:before-handoff-v2:") && values.get(key) === "new draft")!;
    values.set(backup, "changed backup"); const before = [...values];
    expect(() => preserveLegacyHandoffDraft(storage, "draft", "new draft")).toThrow(); expect([...values]).toEqual(before);
  });
  it("rejects oversize intents and records before touching storage", () => {
    const draft = fixture(); draft.handoff.intents[0].update = "A".repeat(512 * 1024 + 4);
    let writes = 0; expect(() => persistNativeHandoffDraft({setItem() { writes++; }, getItem() { return null; }}, "draft", draft)).toThrow(); expect(writes).toBe(0);
    expect(() => parseNativeHandoffDraft(" ".repeat(4 * 1024 * 1024 + 1), scope)).toThrow();
  });
  it("refuses valid-looking update bytes when their recorded digest changed", () => {
    const draft = fixture(); draft.handoff.intents[0].updateSha256 = "0".repeat(64);
    expect(() => parseNativeHandoffDraft(JSON.stringify(draft), scope)).toThrow("update changed");
  });
  it("persists the exact bounded record before application", () => { let raw = ""; const draft = fixture(); persistNativeHandoffDraft({ setItem(_key, value) { raw = value; }, getItem() { return raw; } }, "draft", draft); expect(raw).toBe(JSON.stringify(draft)); });
});

describe("exact-generation native draft ownership", () => {
  function owner() {
    const values = new Map<string, string>(); const storage = { getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { values.set(key, value); }, removeItem(key: string) { values.delete(key); } };
    const initial = fixture(); const make = () => new NativeHandoffDraftOwner(storage, "draft", { base: initial.base, document: initial.document, generation: 2 }, scope, {version:1,profileVersion:4});
    return { values, make };
  }
  it("records before applying, restores identical bytes, and refuses a third transfer", () => {
    const f = owner(), current = f.make(); current.record(new Uint8Array([0,0]), 2, "b38f9046-58cc-43bc-bdf5-e7e1006ef288");
    const reopened = f.make(); expect(reopened.retained()).toEqual(current.retained());
    reopened.record(new Uint8Array([0,0]), 2, "6c322efe-8aaa-4c52-a79b-a3438537c16a"); const before = [...f.values];
    expect(() => reopened.record(new Uint8Array([0,0]), 2, "832dc39c-b030-4506-bd29-e0027028c508")).toThrow(); expect([...f.values]).toEqual(before);
  });
  it("refuses a future draft without changing any stored bytes", () => {
    const f = owner(); f.values.set("draft", JSON.stringify({...fixture(),version:3})); const before = [...f.values];
    expect(() => f.make()).toThrow("unsupported"); expect([...f.values]).toEqual(before);
  });
  it("never clears newer input or a changed storage owner", () => {
    const f = owner(), current = f.make(); current.record(new Uint8Array([0,0]), 2, "b38f9046-58cc-43bc-bdf5-e7e1006ef288");
    current.remember(current.capture().document, 3); const retained = f.values.get("draft");
    expect(() => current.acknowledge(2)).toThrow(); expect(f.values.get("draft")).toBe(retained);
    f.values.set("draft", "other owner"); expect(() => current.acknowledge(3)).toThrow(); expect(f.values.get("draft")).toBe("other owner");
  });
});
