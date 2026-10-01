export function vaultWindowActive(online: boolean, visibility: DocumentVisibilityState, focused: boolean): boolean {
  return online && (visibility === "visible" || focused);
}

export function currentVaultWindowActive(): boolean {
  return vaultWindowActive(navigator.onLine, document.visibilityState, document.hasFocus());
}
