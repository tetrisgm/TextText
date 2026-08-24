import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/editor/agent-skill-metadata-actions", () => ({
  getWorkspaceAgentSkillMetadataAction: vi.fn(async () => ({
    allowed: true,
    skills: [],
  })),
}));

import { AssistantSkillLauncher } from "../AssistantSkillLauncher";
import {
  assistantSkillQuery,
  boundedAssistantSkillMetadata,
  insertAssistantSkillTrigger,
  matchingAssistantSkills,
  skillLauncherKeyAction,
} from "../skill-launcher";

describe("assistant skill metadata", () => {
  it("keeps only bounded names and triggers, never instruction text", () => {
    const skills = boundedAssistantSkillMetadata([
      {
        name: "  Weekly   review ",
        trigger: "WEEKLY-REVIEW",
        instructions: "PRIVATE OWNER INSTRUCTIONS",
      },
      { name: "Duplicate", trigger: "weekly-review", instructions: "secret" },
      { name: "Invalid", trigger: "not valid", instructions: "secret" },
    ]);

    expect(skills).toEqual([
      { name: "Weekly review", trigger: "weekly-review" },
    ]);
    expect(JSON.stringify(skills)).not.toContain("PRIVATE OWNER INSTRUCTIONS");
  });

  it("caps metadata and visible search results", () => {
    const input = Array.from({ length: 20 }, (_, index) => ({
      name: `Skill ${index}`,
      trigger: `skill-${index}`,
      instructions: `Private ${index}`,
    }));
    const metadata = boundedAssistantSkillMetadata(input);
    expect(metadata).toHaveLength(12);
    expect(matchingAssistantSkills(metadata, "/")).toHaveLength(8);
  });
});

describe("assistant skill slash query", () => {
  it("opens only for an initial, unfinished slash token", () => {
    expect(assistantSkillQuery("/")).toBe("");
    expect(assistantSkillQuery("/week")).toBe("week");
    expect(assistantSkillQuery("Ask /week")).toBeNull();
    expect(assistantSkillQuery("/week please")).toBeNull();
    expect(assistantSkillQuery("//week")).toBeNull();
  });

  it("matches names and shortcuts and inserts without executing", () => {
    const skills = [
      { name: "Weekly review", trigger: "review" },
      { name: "Create outline", trigger: "outline" },
    ];
    expect(matchingAssistantSkills(skills, "/week")).toEqual([skills[0]]);
    expect(matchingAssistantSkills(skills, "/out")).toEqual([skills[1]]);
    expect(insertAssistantSkillTrigger("outline")).toBe("/outline ");
  });
});

describe("assistant skill keyboard navigation", () => {
  it("wraps arrow navigation and supports boundary keys", () => {
    expect(
      skillLauncherKeyAction({ activeIndex: 2, count: 3, key: "ArrowDown" }),
    ).toEqual({ kind: "move", index: 0 });
    expect(
      skillLauncherKeyAction({ activeIndex: 0, count: 3, key: "ArrowUp" }),
    ).toEqual({ kind: "move", index: 2 });
    expect(
      skillLauncherKeyAction({ activeIndex: 1, count: 3, key: "Home" }),
    ).toEqual({ kind: "move", index: 0 });
    expect(
      skillLauncherKeyAction({ activeIndex: 1, count: 3, key: "End" }),
    ).toEqual({ kind: "move", index: 2 });
  });

  it("selects with Enter or Tab, dismisses with Escape, and ignores typing", () => {
    expect(
      skillLauncherKeyAction({ activeIndex: 1, count: 3, key: "Enter" }),
    ).toEqual({ kind: "select", index: 1 });
    expect(
      skillLauncherKeyAction({ activeIndex: 2, count: 3, key: "Tab" }),
    ).toEqual({ kind: "select", index: 2 });
    expect(
      skillLauncherKeyAction({ activeIndex: 0, count: 3, key: "Escape" }),
    ).toEqual({ kind: "dismiss" });
    expect(
      skillLauncherKeyAction({ activeIndex: 0, count: 3, key: "a" }),
    ).toEqual({ kind: "none" });
  });
});

describe("assistant skill launcher UI", () => {
  it("renders a compact accessible listbox with mouse-selectable options", () => {
    const skillWithHiddenInstructions = {
      name: "Weekly review",
      trigger: "weekly-review",
      instructions: "DO NOT SEND THIS",
    };
    const html = renderToStaticMarkup(
      React.createElement(AssistantSkillLauncher, {
        composerRef: { current: null },
        onChange: () => {},
        skills: [skillWithHiddenInstructions],
        value: "/",
      }),
    );

    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Reusable skills"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('type="button"');
    expect(html).toContain("Weekly review");
    expect(html).toContain("/weekly-review");
    expect(html).not.toContain("DO NOT SEND THIS");
  });

  it("stays absent once the composer contains an ordinary request", () => {
    const html = renderToStaticMarkup(
      React.createElement(AssistantSkillLauncher, {
        composerRef: { current: null },
        onChange: () => {},
        skills: [{ name: "Weekly review", trigger: "weekly-review" }],
        value: "Please review this",
      }),
    );
    expect(html).toBe("");
  });
});
