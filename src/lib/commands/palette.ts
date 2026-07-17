export function dedupePaletteEntries<T extends { id: string }>(
  entries: readonly T[],
): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}
