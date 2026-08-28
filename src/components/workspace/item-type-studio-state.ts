import type { ItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";

export type StudioRevisionSource = "ai" | "manual" | "starter";

type StudioRevision = {
  id: number;
  label: string;
  source: StudioRevisionSource;
  request?: string;
  blueprint: ItemTypeBlueprint;
};

type StudioTimeline = {
  revisions: StudioRevision[];
  index: number;
  nextId: number;
};

export const EMPTY_STUDIO_TIMELINE: StudioTimeline = {
  revisions: [],
  index: -1,
  nextId: 1,
};

export function currentStudioRevision(
  timeline: StudioTimeline,
): StudioRevision | null {
  return timeline.revisions[timeline.index] ?? null;
}

export function addStudioRevision(
  timeline: StudioTimeline,
  input: Omit<StudioRevision, "id">,
  options: { coalesce?: boolean } = {},
): StudioTimeline {
  const active = currentStudioRevision(timeline);
  if (
    options.coalesce &&
    active?.source === input.source &&
    active.label === input.label
  ) {
    const revisions = timeline.revisions.slice(0, timeline.index + 1);
    revisions[timeline.index] = { ...active, ...input };
    return { ...timeline, revisions };
  }

  const revisions = timeline.revisions.slice(0, timeline.index + 1);
  revisions.push({ id: timeline.nextId, ...input });
  return {
    revisions: revisions.slice(-30),
    index: Math.min(revisions.length, 30) - 1,
    nextId: timeline.nextId + 1,
  };
}

export function moveStudioTimeline(
  timeline: StudioTimeline,
  index: number,
): StudioTimeline {
  if (timeline.revisions.length === 0) return timeline;
  return {
    ...timeline,
    index: Math.max(0, Math.min(index, timeline.revisions.length - 1)),
  };
}

