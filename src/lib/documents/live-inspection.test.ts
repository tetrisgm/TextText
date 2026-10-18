import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDocumentSnapshot } from "./model";
import { registerLiveDocumentInspector } from "./live-inspection";

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });
function setup() { vi.stubGlobal("window", {}); }
function register(id: string, read: Parameters<typeof registerLiveDocumentInspector>[1]) {
  const cleanup = registerLiveDocumentInspector(id, read);
  cleanups.push(cleanup);
  return cleanup;
}

describe("live document inspection", () => {
  it("reads the current full snapshot without allowing mutation", () => {
    setup();
    let document = emptyDocumentSnapshot();
    document.content.title = "Article";
    document.content.subtitle = "Subtitle";
    document.content.body = "Body";
    register("item", () => document);
    const surface = window.texttextDocumentInspection!;
    expect(Object.isFrozen(surface)).toBe(true);
    const copy = surface.read("item")!;
    expect(copy).toEqual(document);
    copy.content.body = "Caller mutation";
    expect(document.content.body).toBe("Body");
    document = { ...document, content: { ...document.content, subtitle: "Latest local edit" } };
    expect(surface.read("item")!.content.subtitle).toBe("Latest local edit");
  });

  it("returns null after closure and rejects ambiguous live editors", () => {
    setup();
    const document = emptyDocumentSnapshot();
    const first = register("item", () => document);
    const second = register("item", () => document);
    expect(() => window.texttextDocumentInspection!.read("item")).toThrow("Multiple live editors");
    first();
    expect(window.texttextDocumentInspection!.read("item")).toEqual(document);
    first(); // A stale cleanup must not remove the remaining registration.
    expect(window.texttextDocumentInspection!.read("item")).toEqual(document);
    second();
    expect(window.texttextDocumentInspection!.read("item")).toBeNull();
  });

  it("validates schema and identity and never invokes a writer", () => {
    setup();
    const read = vi.fn(() => ({ schemaVersion: 999 }) as unknown as ReturnType<typeof emptyDocumentSnapshot>);
    register("invalid", read);
    expect(() => window.texttextDocumentInspection!.read("invalid")).toThrow();
    expect(read).toHaveBeenCalledTimes(1);
    expect(() => window.texttextDocumentInspection!.read("bad\nidentity")).toThrow("Invalid open document");
    expect(window.texttextDocumentInspection!.read("closed")).toBeNull();
    expect(Object.keys(window.texttextDocumentInspection!)).toEqual(["version", "read"]);
  });
});
