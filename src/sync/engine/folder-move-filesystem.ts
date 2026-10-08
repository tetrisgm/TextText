import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export interface FolderTreeEntry { path: string; type: "directory" | "file"; identity: string }
export interface FolderTreeSnapshot { entries: FolderTreeEntry[]; hash: string }
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Retains only fingerprints, never archives. Rejects aliases and non-file
 * objects before an intent can authorize moving an entire directory tree. */
export async function snapshotFolderTree(root: string): Promise<FolderTreeSnapshot> {
  const entries: FolderTreeEntry[] = [];
  async function walk(relative: string): Promise<void> {
    const current = path.join(root, relative);
    const stat = await fs.lstat(current, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error("Folder contains an unsupported filesystem entry");
    if (entries.length >= 100_000) throw Error("Folder move exceeds the supported entry limit");
    // Directory rename changes ctime but preserves object identity. File
    // mutation/replacement invalidates the intent before publication.
    const identity = stat.isDirectory()
      ? `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`
      : `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    entries.push({ path: relative, type: stat.isDirectory() ? "directory" : "file", identity });
    if (stat.isDirectory()) for (const name of (await fs.readdir(current)).sort()) await walk(relative ? `${relative}/${name}` : name);
  }
  await walk("");
  return { entries, hash: digest(JSON.stringify(entries)) };
}

export async function verifyFolderParents(workspace: string, relative: string): Promise<string> {
  if (!relative || relative.startsWith("/") || relative.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".") || /[\\\x00-\x1f]/.test(part))) throw Error("Invalid folder path");
  let current = workspace;
  const root = await fs.lstat(current);
  if (!root.isDirectory() || root.isSymbolicLink()) throw Error("Invalid workspace directory");
  for (const part of relative.split("/").slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Folder parent is unavailable");
  }
  return path.join(current, relative.split("/").at(-1)!);
}

export async function assertFolderDestinationAvailable(destination: string): Promise<void> {
  const name = path.basename(destination).normalize("NFC").toLowerCase();
  if ((await fs.readdir(path.dirname(destination))).some(entry => entry.normalize("NFC").toLowerCase() === name)) throw Error("Folder destination is occupied");
}
