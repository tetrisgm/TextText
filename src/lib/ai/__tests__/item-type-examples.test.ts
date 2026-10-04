import { describe, expect, it } from "vitest";

import { itemTypeExamplesFor, rankItemTypeExamples } from "@/lib/ai/item-type-examples";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";

/**
 * Deterministic, so the selection can be trusted without spending a model
 * call. The look suite measures whether the examples HELP; this measures
 * whether the right ones get chosen at all.
 */
describe("item type examples", () => {
  it("offers only templates still in the catalogue", () => {
    const active = new Set(BUILTIN_TEMPLATES.map((template) => template.id));
    const everything = [
      "tasks due date priority",
      "project status dates",
      "page cover icon",
      "gallery of photos",
      "article story reading",
    ].flatMap((request) => rankItemTypeExamples(request));
    expect(everything.length).toBeGreaterThan(0);
    for (const entry of everything) expect(active.has(entry.template.id)).toBe(true);
  });

  it("puts Tasks first for a to-do request", () => {
    const ranked = rankItemTypeExamples(
      "a to-do list where each task has a due date and a priority",
    );
    expect(ranked[0]?.template.id).toBe("texttext.todo");
  });

  it("does not offer a retired project look to the model", () => {
    const request = "a project page with status and dates";
    expect(rankItemTypeExamples(request)).toEqual([]);
    expect(itemTypeExamplesFor(request)).toBe("");
  });

  it("puts Gallery first when the pictures lead", () => {
    const ranked = rankItemTypeExamples("photos where the pictures lead");
    expect(ranked[0]?.template.id).toBe("texttext.gallery");
  });

  it("matches on plural and singular alike", () => {
    expect(rankItemTypeExamples("tasks")[0]?.template.id).toBe(
      rankItemTypeExamples("task")[0]?.template.id,
    );
  });

  it("says nothing rather than offering a misleading neighbour", () => {
    expect(itemTypeExamplesFor("")).toBe("");
    expect(itemTypeExamplesFor("zzzqqq wibble frobnicate")).toBe("");
  });

  it("does not let one incidental word qualify a template", () => {
    // "time" appears in several exemplar bodies. On its own it is not a genre.
    for (const entry of rankItemTypeExamples("time")) {
      expect(entry.score).toBeGreaterThanOrEqual(3);
    }
  });

  it("hands over at most the limit, with fields and a real document", () => {
    const request = "notes bookmarks gallery presentation task list";
    expect(rankItemTypeExamples(request).length).toBeGreaterThan(2);
    const block = itemTypeExamplesFor(request, 2);
    expect(block.match(/^Example: /gm)?.length).toBe(2);
    expect(block).toContain("Fields:");
    expect(block).toContain("Folder view:");
    expect(block).toContain("A real one reads:");
  });

  it("describes the concrete fields in the active task-list example", () => {
    const block = itemTypeExamplesFor("a task list with several tasks", 2);
    expect(block).toContain("items (rows of task, done)");
    expect(block).not.toContain("Example: Project");
  });
});
