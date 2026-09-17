import { createHash } from "node:crypto";

/**
 * The For You order, as a small formula anyone can read.
 *
 * Version 1. Deterministic: the same candidates, state, and preferences
 * give the same order, and a snapshot id names that order so paging and
 * returning from an article do not reshuffle. No model call. Every term is
 * recorded on the result so "Why this is here" can list the ones that
 * fired, by name, instead of inventing a story.
 */

export const RANK_VERSION = 1;

export type RankCandidate = {
  id: string;
  latestAt: string;
  /** Distinct source names, for breadth and for source reductions. */
  sources: string[];
  /** Source folder paths, the target of a source_less preference. */
  sourcePaths: string[];
  topicIds: string[];
  coverageRevision: number;
  /** What the person has seen of it; 0 when never. */
  seenRevision: number;
  /** Cosine similarity of the unit to the person's Keep and star centroid, or null without embeddings. */
  affinity: number | null;
};

export type RankPreferences = {
  topicMore: Set<string>;
  topicLess: Set<string>;
  sourceLess: Set<string>;
};

export type RankTerm = { name: string; value: number };
export type Ranked<T extends RankCandidate> = { candidate: T; score: number; terms: RankTerm[] };

const WEIGHTS = { freshness: 3, newCoverage: 2, interest: 2, affinity: 1, breadth: 0.5, seen: -2, reduction: -2 } as const;
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/** 1 at now, 0.5 at a day, 0 at the seven-day horizon, in log time so hours matter more than days. */
export function freshness(latestAt: string, now: number): number {
  const age = Math.max(0, now - new Date(latestAt).getTime());
  if (age >= HORIZON_MS) return 0;
  const day = 24 * 60 * 60 * 1000;
  const value = 1 - Math.log1p(age / day) / Math.log1p(HORIZON_MS / day);
  return Math.max(0, Math.min(1, value));
}

export function scoreCandidate(candidate: RankCandidate, preferences: RankPreferences, now: number): { score: number; terms: RankTerm[] } {
  const terms: RankTerm[] = [];
  const add = (name: string, value: number) => {
    if (value !== 0) terms.push({ name, value: Math.round(value * 100) / 100 });
  };
  add("fresh", WEIGHTS.freshness * freshness(candidate.latestAt, now));
  if (candidate.seenRevision > 0 && candidate.coverageRevision > candidate.seenRevision) add("new coverage", WEIGHTS.newCoverage);
  if (candidate.topicIds.some((topic) => preferences.topicMore.has(topic))) add("your interest", WEIGHTS.interest);
  if (candidate.affinity !== null && candidate.affinity > 0) add("like what you keep", WEIGHTS.affinity * Math.min(1, candidate.affinity));
  const distinct = new Set(candidate.sources).size;
  if (distinct > 1) add("several sources", WEIGHTS.breadth * (Math.min(3, distinct) / 3));
  if (candidate.seenRevision > 0 && candidate.seenRevision >= candidate.coverageRevision) add("already seen", WEIGHTS.seen);
  const reducedTopics = candidate.topicIds.some((topic) => preferences.topicLess.has(topic));
  const reducedSources = candidate.sourcePaths.filter((path) => preferences.sourceLess.has(path)).length;
  const share = candidate.sourcePaths.length > 0 ? reducedSources / candidate.sourcePaths.length : 0;
  const reduction = Math.max(reducedTopics ? 1 : 0, share);
  if (reduction > 0) add("less of this", WEIGHTS.reduction * reduction);
  return { score: terms.reduce((sum, term) => sum + term.value, 0), terms };
}

const MAX_PER_SOURCE_IN_TOP = 3;
const MAX_PER_TOPIC_IN_TOP = 4;
const TOP = 12;

/** Score, sort with a stable tie-break, then keep the top of the list varied. */
export function rankCandidates<T extends RankCandidate>(candidates: T[], preferences: RankPreferences, now: number): Ranked<T>[] {
  const scored = candidates
    .map((candidate) => ({ candidate, ...scoreCandidate(candidate, preferences, now) }))
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  const head: Ranked<T>[] = [];
  const deferred: Ranked<T>[] = [];
  const perSource = new Map<string, number>();
  const perTopic = new Map<string, number>();
  for (const entry of scored) {
    if (head.length >= TOP) {
      deferred.push(entry);
      continue;
    }
    const source = entry.candidate.sources[0] ?? "";
    const topic = entry.candidate.topicIds[0] ?? "";
    const sourceCount = perSource.get(source) ?? 0;
    const topicCount = topic ? perTopic.get(topic) ?? 0 : 0;
    if ((source && sourceCount >= MAX_PER_SOURCE_IN_TOP) || (topic && topicCount >= MAX_PER_TOPIC_IN_TOP)) {
      deferred.push(entry);
      continue;
    }
    head.push(entry);
    if (source) perSource.set(source, sourceCount + 1);
    if (topic) perTopic.set(topic, topicCount + 1);
  }
  return [...head, ...deferred];
}

/** Names this order: the same inputs give the same id, so a page taken later is the same page. */
export function snapshotId(orderedIds: string[]): string {
  return createHash("sha256").update(`${RANK_VERSION}\n${orderedIds.join("\n")}`).digest("hex").slice(0, 16);
}

export function cosine(left: number[], right: number[]): number {
  let dot = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) dot += left[index] * right[index];
  return dot;
}

export function meanVector(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dims = vectors[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const vector of vectors) for (let index = 0; index < dims; index += 1) sum[index] += vector[index] ?? 0;
  let norm = 0;
  for (const value of sum) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return sum.map((value) => value / norm);
}
