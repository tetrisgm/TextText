import { describe, expect, it } from "vitest";
import { ITEM_TYPE_STARTERS } from "@/lib/presentation/item-type-blueprint";
import {
  EMPTY_STUDIO_TIMELINE,
  addStudioRevision,
  currentStudioRevision,
  moveStudioTimeline,
} from "../item-type-studio-state";

const first = ITEM_TYPE_STARTERS[0].blueprint;
const second = { ...first, name: "Second design" };
const third = { ...first, name: "Third design" };

describe("item type studio timeline", () => {
  it("moves backward and forward across named revisions", () => {
    const started = addStudioRevision(EMPTY_STUDIO_TIMELINE, {
      label: "Started with Editorial",
      source: "starter",
      blueprint: first,
    });
    const refined = addStudioRevision(started, {
      label: "AI refinement",
      source: "ai",
      request: "Make the cover larger",
      blueprint: second,
    });

    expect(currentStudioRevision(refined)?.blueprint.name).toBe("Second design");
    expect(currentStudioRevision(moveStudioTimeline(refined, 0))?.blueprint.name).toBe(
      first.name,
    );
    expect(currentStudioRevision(moveStudioTimeline(refined, 1))?.blueprint.name).toBe(
      "Second design",
    );
  });

  it("coalesces consecutive manual edits into one reversible step", () => {
    const started = addStudioRevision(EMPTY_STUDIO_TIMELINE, {
      label: "Initial design",
      source: "starter",
      blueprint: first,
    });
    const firstEdit = addStudioRevision(
      started,
      { label: "Edited details", source: "manual", blueprint: second },
      { coalesce: true },
    );
    const secondEdit = addStudioRevision(
      firstEdit,
      { label: "Edited details", source: "manual", blueprint: third },
      { coalesce: true },
    );

    expect(secondEdit.revisions).toHaveLength(2);
    expect(currentStudioRevision(secondEdit)?.blueprint.name).toBe("Third design");
    expect(currentStudioRevision(moveStudioTimeline(secondEdit, 0))?.blueprint.name).toBe(
      first.name,
    );
  });

  it("drops redo revisions when a past version becomes a new branch", () => {
    const firstRevision = addStudioRevision(EMPTY_STUDIO_TIMELINE, {
      label: "First",
      source: "starter",
      blueprint: first,
    });
    const secondRevision = addStudioRevision(firstRevision, {
      label: "Second",
      source: "ai",
      blueprint: second,
    });
    const rewound = moveStudioTimeline(secondRevision, 0);
    const branched = addStudioRevision(rewound, {
      label: "New direction",
      source: "ai",
      blueprint: third,
    });

    expect(branched.revisions.map((revision) => revision.label)).toEqual([
      "First",
      "New direction",
    ]);
    expect(currentStudioRevision(branched)?.blueprint.name).toBe("Third design");
  });
});
