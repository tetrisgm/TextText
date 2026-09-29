import { afterEach, expect, it, vi } from "vitest";
import { downloadJsonCopy } from "@/lib/native-download";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("requires the Mac save to finish before confirming a recovery export", async () => {
  const window = new EventTarget() as EventTarget & {
    __TEXTTEXT_APP__: boolean;
    document: { createElement: () => { href: string; download: string; click: () => void } };
  };
  window.__TEXTTEXT_APP__ = true;
  let filename = "";
  window.document = { createElement: () => ({
    href: "", download: "", click() { filename = this.download; },
  }) };
  vi.stubGlobal("window", window);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovery");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

  const pending = downloadJsonCopy("recovery.json", { body: "Unsaved writing" });
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  expect(filename).toBe("recovery.json");
  expect(settled).toBe(false);

  const result = Object.assign(new Event("texttext:native-download-result"), {
    detail: { filename: "recovery.json", saved: true },
  });
  window.dispatchEvent(result);
  expect(await pending).toBe(true);
  expect(revoke).toHaveBeenCalledWith("blob:recovery");
});

it("keeps recovery export unconfirmed when the Mac save is canceled", async () => {
  const window = new EventTarget() as EventTarget & {
    __TEXTTEXT_APP__: boolean;
    document: { createElement: () => { href: string; download: string; click: () => void } };
  };
  window.__TEXTTEXT_APP__ = true;
  window.document = { createElement: () => ({ href: "", download: "", click() {} }) };
  vi.stubGlobal("window", window);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovery");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const pending = downloadJsonCopy("recovery.json", { body: "Unsaved writing" });
  window.dispatchEvent(Object.assign(new Event("texttext:native-download-result"), {
    detail: { filename: "recovery.json", saved: false },
  }));
  expect(await pending).toBe(false);
});

it("keeps recovery export unconfirmed when WebKit never reports a result", async () => {
  vi.useFakeTimers();
  const window = new EventTarget() as EventTarget & {
    __TEXTTEXT_APP__: boolean;
    document: { createElement: () => { href: string; download: string; click: () => void } };
  };
  window.__TEXTTEXT_APP__ = true;
  window.document = { createElement: () => ({ href: "", download: "", click() {} }) };
  vi.stubGlobal("window", window);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovery");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const pending = downloadJsonCopy("recovery.json", { body: "Unsaved writing" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await pending).toBe(false);
});
