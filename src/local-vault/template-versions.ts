/** Creation uses one latest version per identity. Keep discovery intact for pinned look lookup. */
export function latestTemplateVersions<T extends { template: { id: string; version: number }; path?: string }>(looks: readonly T[]): T[] {
  const latest = new Map<string, T>();
  const versions = new Set<string>();
  for (const look of looks) {
    const key = JSON.stringify([look.template.id, look.template.version]);
    if (versions.has(key)) throw new Error("A template version is ambiguous. Remove its duplicate library file before choosing it.");
    versions.add(key);
    const previous = latest.get(look.template.id);
    if (!previous || look.template.version > previous.template.version ||
      look.template.version === previous.template.version && (look.path ?? "") < (previous.path ?? "")) latest.set(look.template.id, look);
  }
  return [...latest.values()];
}
