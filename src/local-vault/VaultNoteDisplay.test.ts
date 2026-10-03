import { describe, expect, it } from "vitest";
import { toggleNoteTask } from "./VaultNoteDisplay";

describe("note checklist toggles", () => {
  it("changes only the selected task marker and preserves the body", () => {
    const body = "Before\n- [ ] First\n- [x] Second\nAfter";
    expect(toggleNoteTask(body, 0)).toBe("Before\n- [x] First\n- [x] Second\nAfter");
    expect(toggleNoteTask(body, 1)).toBe("Before\n- [ ] First\n- [ ] Second\nAfter");
    expect(toggleNoteTask(body, 2)).toBeNull();
  });

  it("does not count checkbox-looking text in fenced code", () => {
    const body = "```md\n- [ ] Example\n```\n- [ ] Real";
    expect(toggleNoteTask(body, 0)).toBe("```md\n- [ ] Example\n```\n- [x] Real");
  });
});
