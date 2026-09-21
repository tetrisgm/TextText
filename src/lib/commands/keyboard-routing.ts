export function shouldDeferKeyToActiveOverlay(
  activeOverlayCount: number,
  key: string,
): boolean {
  return activeOverlayCount > 0 && key !== "Escape";
}

export function shouldDeferNativeActivation(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  control: "button" | "link" | null,
): boolean {
  if (!control || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  return event.key === "Enter" || (event.key === " " && control === "button");
}
