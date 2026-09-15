/**
 * Rollout switches for source-fed reading. Read once per process from the
 * environment; a value is a fact about this deployment, not a preference.
 *
 * Automatic cleanup is the one switch that can remove things, and it starts
 * off. Everything else starts on because it only adds.
 */
function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export const readingFlags = Object.freeze({
  /** Feed connections can be created and polled. */
  connections: flag("TEXTTEXT_READING_ENABLED", true),
  /** Grouped Summaries are computed and offered. */
  summaries: flag("TEXTTEXT_READING_SUMMARIES", true),
  /** Chunks are embedded when a capable provider is configured. */
  semanticIndex: flag("TEXTTEXT_READING_SEMANTIC", true),
  /**
   * The sweep may actually move expired items to the Trash. Off until the
   * protection, index and sync tests have passed on the deployment that runs
   * it; preview and dry run work regardless.
   */
  automaticCleanup: flag("TEXTTEXT_READING_CLEANUP", false),
});

export type ReadingFlags = typeof readingFlags;
