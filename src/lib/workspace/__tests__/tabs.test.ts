import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

async function freshTabs(scope = "/@a") {
  vi.resetModules();
  vi.stubGlobal("window", { localStorage: memoryStorage() });
  const module = await import("@/lib/workspace/tabs");
  module.useTabScope(scope);
  return module;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace tabs", () => {
  it("opens each document once, in the order they were opened", async () => {
    const t = await freshTabs();
    t.openTab("a");
    t.openTab("b");
    t.openTab("a");
    expect(t.currentTabs()).toEqual(["a", "b"]);
  });

  it("closing says where to go: left, then right, then nowhere", async () => {
    const t = await freshTabs();
    for (const id of ["a", "b", "c"]) t.openTab(id);
    expect(t.closeTab("b")).toBe("a");
    expect(t.currentTabs()).toEqual(["a", "c"]);
    expect(t.closeTab("a")).toBe("c");
    expect(t.closeTab("c")).toBe(null);
    expect(t.currentTabs()).toEqual([]);
  });

  it("cycles with wrapping in both directions", async () => {
    const t = await freshTabs();
    for (const id of ["a", "b", "c"]) t.openTab(id);
    expect(t.tabAfter("a", 1)).toBe("b");
    expect(t.tabAfter("c", 1)).toBe("a");
    expect(t.tabAfter("a", -1)).toBe("c");
    expect(t.tabAfter(null, 1)).toBe("a");
  });

  it("prunes documents that no longer exist", async () => {
    const t = await freshTabs();
    for (const id of ["a", "b", "c"]) t.openTab(id);
    t.pruneTabs((id) => id !== "b");
    expect(t.currentTabs()).toEqual(["a", "c"]);
  });

  it("remembers tabs per workspace", async () => {
    const t = await freshTabs("/@a");
    t.openTab("a");
    t.openTab("b");
    t.useTabScope("/@other");
    expect(t.currentTabs()).toEqual([]);
    t.useTabScope("/@a");
    expect(t.currentTabs()).toEqual(["a", "b"]);
  });
});
