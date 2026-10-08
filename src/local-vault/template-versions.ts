/** Creation uses one latest version per identity. Keep discovery intact for pinned look lookup. */
export function latestTemplateVersions<T extends { template: { id: string; version: number }; path?: string }>(looks: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const look of looks) {
    const previous = latest.get(look.template.id);
    if (!previous || look.template.version > previous.template.version ||
      look.template.version === previous.template.version && (look.path ?? "") < (previous.path ?? "")) latest.set(look.template.id, look);
  }
  return [...latest.values()];
}
