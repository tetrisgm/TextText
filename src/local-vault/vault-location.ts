import { folderForItem } from "./folders";

export type VaultLocation = { folder: string; path?: string };

const PREFIX = "texttext:vault-location:";
const MAX_PATH_LENGTH = 4096;

function ordinaryPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_PATH_LENGTH && !/[\u0000-\u001f]/.test(value);
}

export function readVaultLocation(storage: Pick<Storage, "getItem">, root: string): VaultLocation | null {
  try {
    const value = JSON.parse(storage.getItem(PREFIX + root) ?? "null") as unknown;
    if (!value || typeof value !== "object") return null;
    const folder = (value as { folder?: unknown }).folder;
    const path = (value as { path?: unknown }).path;
    if (!ordinaryPath(folder) || (path !== undefined && !ordinaryPath(path))) return null;
    return { folder, ...(path ? { path } : {}) };
  } catch {
    return null;
  }
}

export function resolveVaultLocation(
  saved: VaultLocation | null,
  itemPaths: readonly string[],
  folderPaths: readonly string[],
): VaultLocation {
  if (saved?.path && itemPaths.includes(saved.path)) {
    return { folder: folderForItem(saved.path), path: saved.path };
  }
  if (saved && (saved.folder === "" || folderPaths.includes(saved.folder))) {
    return { folder: saved.folder };
  }
  return { folder: "" };
}

export function writeVaultLocation(storage: Pick<Storage, "setItem">, root: string, location: VaultLocation) {
  storage.setItem(PREFIX + root, JSON.stringify(location));
}
