export const preferenceQueries = {
  reducedMotion: "(prefers-reduced-motion: reduce)",
  reducedTransparency: "(prefers-reduced-transparency: reduce)",
  contrast: "(prefers-contrast: more)",
} as const;
export type MotionPreferences = Record<keyof typeof preferenceQueries, boolean>;
export function readPreferences(): MotionPreferences {
  const matches = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;
  return {
    reducedMotion: matches(preferenceQueries.reducedMotion),
    reducedTransparency: matches(preferenceQueries.reducedTransparency),
    contrast: matches(preferenceQueries.contrast),
  };
}
export function observePreferences(update: (preferences: MotionPreferences) => void) {
  const lists = typeof matchMedia === "function" ? Object.values(preferenceQueries).map((q) => matchMedia(q)) : [];
  const changed = () => update(readPreferences());
  lists.forEach((list) => list.addEventListener("change", changed));
  changed();
  return () => lists.forEach((list) => list.removeEventListener("change", changed));
}
