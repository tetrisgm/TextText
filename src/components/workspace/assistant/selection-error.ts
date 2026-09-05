"use client";

export const SELECTION_ERROR_EVENT = "texttext:selection-error";
export function reportSelectionError(itemId: string, message: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SELECTION_ERROR_EVENT, { detail: { itemId, message } }));
  }
}
