import { strFromU8, unzipSync } from "fflate";

/** Search only text.md, never decompressing image or attachment entries. */
export function searchVaultPack(bytes: Uint8Array, path: string, terms: readonly string[]): { title: string; snippet: string } | null {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("TextPack exceeds search limit");
  const files = unzipSync(bytes, { filter(entry) {
    return /(?:^|\/)text\.md$/.test(entry.name) && entry.originalSize <= 2 * 1024 * 1024;
  } });
  const markdown = Object.entries(files).find(([name]) => /(?:^|\/)text\.md$/.test(name));
  if (!markdown) throw new Error("TextPack has no searchable text");
  const text = strFromU8(markdown[1]);
  const searchable = `${path}\n${text}`.toLocaleLowerCase();
  if (!terms.every(term => searchable.includes(term))) return null;
  const title = text.match(/^---\r?\n[\s\S]*?^title:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") || path.split("/").at(-1)?.replace(/\.textpack$/i, "") || path;
  const body = text.replace(/^---\r?\n[\s\S]*?^---\s*\r?\n/m, "");
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return { title: title.slice(0, 300), snippet: (lines.find(line => terms.some(term => line.toLocaleLowerCase().includes(term))) || lines[0] || "").slice(0, 240) };
}
