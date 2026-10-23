/** New server-side destinations must be representable on every native client.
 * This validates names only; the store still owns containment and alias checks. */
export function validatePortableFolderPath(folder: string): string {
  if (folder.length > 1000 || (folder !== "" && folder.split("/").some(part =>
    !part || part.startsWith(".") || /[\\\x00-\x1f:?*"<>|]/.test(part) ||
    /[. ]$/.test(part) || part.toLowerCase().endsWith(".textpack") ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) {
    throw new Error("Choose a portable folder path without reserved names or trailing spaces or dots.");
  }
  return folder;
}
