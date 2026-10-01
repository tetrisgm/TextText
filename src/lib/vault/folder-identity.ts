import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";

const workspaceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validVaultItemId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

export function validVaultFolderPath(value: string): boolean {
  return value.length > 0 && value.length <= 1000 && !value.startsWith("/") &&
    value.split("/").every(part => part.length > 0 && part !== "." && part !== ".." &&
      !part.startsWith(".") && !/[\\\x00-\x1f:]/.test(part));
}

export function validVaultTextpackPath(value: string): boolean {
  if (!value.endsWith(".textpack") || value.length > 1000) return false;
  const parts = value.split("/");
  return parts.length === 1
    ? validVaultFolderPath(parts[0])
    : validVaultFolderPath(parts.slice(0, -1).join("/")) && validVaultFolderPath(parts.at(-1)!);
}

/** Identifies the current directory object, not merely a reused pathname.
 * A rename outside the server's control closes this grant until the owner
 * shares the new path. Folder contents can change without changing this key. */
export async function vaultFolderSignature(root: string, workspaceId: string, folderPath: string): Promise<string | null> {
  if (!path.isAbsolute(root) || !workspaceIdPattern.test(workspaceId) || !validVaultFolderPath(folderPath)) return null;
  let current: string;
  try { current = await fs.realpath(root); } catch { return null; }
  const parts = [workspaceId, ...folderPath.split("/")];
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    try {
      const info = await fs.lstat(current, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink()) return null;
      if (index === parts.length - 1) {
        // The stable birth time fences inode reuse after deletion. The hash
        // also keeps filesystem details out of permission rows and responses.
        return createHash("sha256").update(`${info.dev}:${info.ino}:${info.birthtimeNs}`).digest("hex");
      }
    } catch { return null; }
  }
  return null;
}
