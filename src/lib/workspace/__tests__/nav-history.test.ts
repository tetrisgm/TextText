import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readNavTrail,
  readScrollMemory,
  writeNavTrail,
  writeScrollMemory,
} from "@/lib/workspace/nav-history";

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

describe("nav-history trail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a trail per scope", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    writeNavTrail("/@a", { entries: ["/@a", "/@a/x"], index: 1 });
    writeNavTrail("/@b", { entries: ["/@b"], index: 0 });
    expect(readNavTrail("/@a")).toEqual({ entries: ["/@a", "/@a/x"], index: 1 });
    expect(readNavTrail("/@b")).toEqual({ entries: ["/@b"], index: 0 });
  });

  it("returns null for a missing or malformed trail", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    expect(readNavTrail("/@missing")).toBeNull();
    storage.setItem("texttext:nav-trail:/@bad", "{not json");
    expect(readNavTrail("/@bad")).toBeNull();
    storage.setItem(
      "texttext:nav-trail:/@oob",
      JSON.stringify({ entries: ["/@oob"], index: 5 }),
    );
    expect(readNavTrail("/@oob")).toBeNull();
  });

  it("refuses to overwrite a good trail with a sparse one", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    const good = { entries: ["/@a", "/@a/x", "/@a/y"], index: 2 };
    writeNavTrail("/@a", good);
    // What a reload used to hand us: an array whose only filled slot is the
    // current index. JSON writes the holes as null, readNavTrail then rejects
    // the whole thing, and the person's history is gone.
    const sparse: string[] = [];
    sparse[2] = "/@a/y";
    writeNavTrail("/@a", { entries: sparse, index: 2 });
    expect(readNavTrail("/@a")).toEqual(good);
  });

  it("refuses a trail whose index does not address an entry", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    writeNavTrail("/@a", { entries: ["/@a"], index: 0 });
    writeNavTrail("/@a", { entries: ["/@a", "/@a/x"], index: 7 });
    expect(readNavTrail("/@a")).toEqual({ entries: ["/@a"], index: 0 });
    writeNavTrail("/@a", { entries: [], index: 0 });
    expect(readNavTrail("/@a")).toEqual({ entries: ["/@a"], index: 0 });
  });

  it("keeps the recent window and re-bases the index when the trail is long", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    const entries = Array.from({ length: 60 }, (_, i) => `/@s/${i}`);
    writeNavTrail("/@s", { entries, index: 59 });
    const back = readNavTrail("/@s");
    expect(back?.entries.length).toBe(50);
    // The current entry is still addressed and is still the last one.
    expect(back?.entries[back.index]).toBe("/@s/59");
  });
});

describe("scroll memory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips positions per scope and drops non-positive ones", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    writeScrollMemory("/@a", { "item:1": 1400, "section:notes": 220, "item:2": 0 });
    expect(readScrollMemory("/@a")).toEqual({
      "item:1": 1400,
      "section:notes": 220,
    });
    expect(readScrollMemory("/@b")).toEqual({});
  });

  it("ignores malformed storage rather than throwing", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem("texttext:scroll-memory:/@bad", "{nope");
    expect(readScrollMemory("/@bad")).toEqual({});
    storage.setItem(
      "texttext:scroll-memory:/@arr",
      JSON.stringify(["not", "an", "object"]),
    );
    expect(readScrollMemory("/@arr")).toEqual({});
  });
});
