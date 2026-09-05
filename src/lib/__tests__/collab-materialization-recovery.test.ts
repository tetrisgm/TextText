import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { keepMaterializationRecovery, readMaterializationRecoveries, acknowledgeMaterializationRecoveries } from "@/lib/collab/materialization-recovery";

function storage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("explicit materialization recovery", () => {
  it("retains independent rejected copies across reloads, separate from live state", () => {
    storage();
    const document = emptyDocumentSnapshot();
    document.content.body = "My rejected edit";
    const first = { id: "tab-a", postId: "post", epoch: 0, state: "full Yjs state", document };
    const second = { ...first, id: "tab-b", state: "another full state" };
    expect(keepMaterializationRecovery(first)).toBe(true);
    expect(keepMaterializationRecovery(second)).toBe(true);
    expect(readMaterializationRecoveries("post")).toEqual([first, second]);
    expect(readMaterializationRecoveries("other-post")).toEqual([]);
    acknowledgeMaterializationRecoveries([first]);
    expect(readMaterializationRecoveries("post")).toEqual([second]);
  });

  it("reports unavailable storage without losing the in-memory recovery object", () => {
    vi.stubGlobal("localStorage", { setItem() { throw new Error("Quota exceeded"); } });
    const copy = { id: "copy", postId: "post", epoch: 7, state: "Retained", document: emptyDocumentSnapshot() };
    expect(keepMaterializationRecovery(copy)).toBe(false);
    expect(copy.state).toBe("Retained");
  });
});
