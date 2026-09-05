import { afterEach, describe, expect, it, vi } from "vitest";
import { presentSelectionPreview, SELECTION_PREVIEW_EVENT, type SelectionPreviewEventDetail } from "../selection-preview-event";
import type { InlinePreviewController } from "../inline-preview";

afterEach(() => vi.unstubAllGlobals());
describe("rail selection preview delivery", () => {
  it("disposes a preview if its editor unmounted before delivery", () => {
    vi.stubGlobal("window", new EventTarget());
    const dispose = vi.fn();
    expect(presentSelectionPreview({ itemId: "old-item", controller: { dispose } as unknown as InlinePreviewController, surface: {} as never })).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("delivers the same frozen controller to the editor without generating twice", () => {
    const target = new EventTarget(); vi.stubGlobal("window", target);
    const dispose = vi.fn(); const controller = { dispose } as unknown as InlinePreviewController;
    target.addEventListener(SELECTION_PREVIEW_EVENT, (event) => {
      const message = (event as CustomEvent<SelectionPreviewEventDetail>).detail;
      expect(message.itemId).toBe("item"); expect(message.controller).toBe(controller);
      message.accepted = true;
    });
    expect(presentSelectionPreview({ itemId: "item", controller, surface: {} as never })).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
  });
});
