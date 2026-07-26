export function shouldDeferKeyToActiveOverlay(
  activeOverlayCount: number,
  key: string,
): boolean {
  return activeOverlayCount > 0 && key !== "Escape";
}
