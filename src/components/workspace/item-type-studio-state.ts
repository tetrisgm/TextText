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

/**
 * A timeline that starts from a look already in the workspace.
 *
 * Opening the studio on an existing type has to begin somewhere, and beginning
 * empty would mean the person watches their own look disappear and rebuilds it
 * from a blank prompt. The look they are changing IS the first revision, so
 * undo has somewhere to go back to and the diff panel has something to compare
 * against from the first edit.
 */
export function studioTimelineFrom(
  blueprint: ItemTypeBlueprint,
): StudioTimeline {
  return {
    revisions: [
      { id: 1, label: "How it is now", source: "starter", blueprint },
    ],
    index: 0,
    nextId: 2,
  };
}

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

