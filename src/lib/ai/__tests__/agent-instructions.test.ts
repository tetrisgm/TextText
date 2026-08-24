import { describe, expect, it } from "vitest";
import {
  buildWorkspaceAgentPrompt,
  cleanWorkspaceAgentSettings,
  MAX_WORKSPACE_AGENT_INSTRUCTIONS,
  requestedWorkspaceAgentSkills,
  safeWorkspaceAgentSettings,
} from "@/lib/ai/agent-instructions";

const settings = {
  instructions: "Keep answers concise.\r\nPreserve the writer's terminology.",
  skills: [
    {
      name: "Weekly review",
      trigger: "/weekly-review",
      instructions:
        "Group open work by outcome and end with three next actions.",
    },
    {
      name: "Polish prose",
      trigger: "polish",
      instructions: "Tighten sentences without changing their meaning.",
    },
  ],
};

describe("workspace agent instructions", () => {
  it("normalizes bounded settings and explicit skill shortcuts", () => {
    expect(cleanWorkspaceAgentSettings(settings)).toEqual({
      instructions: "Keep answers concise.\nPreserve the writer's terminology.",
      skills: [
        { ...settings.skills[0], trigger: "weekly-review" },
        settings.skills[1],
      ],
    });
  });

  it("fails closed for malformed stored settings", () => {
    expect(
      safeWorkspaceAgentSettings({ instructions: "Use this", skills: "all" }),
    ).toEqual({ instructions: "", skills: [] });
    expect(
      safeWorkspaceAgentSettings({
        instructions: "x".repeat(MAX_WORKSPACE_AGENT_INSTRUCTIONS + 1),
        skills: [],
      }),
    ).toEqual({ instructions: "", skills: [] });
  });

  it("rejects duplicate shortcuts", () => {
    expect(() =>
      cleanWorkspaceAgentSettings({
        instructions: "",
        skills: [
          settings.skills[1],
          { ...settings.skills[1], name: "Another" },
        ],
      }),
    ).toThrow("used more than once");
  });

  it("activates skills only when the current request explicitly addresses them", () => {
    const clean = cleanWorkspaceAgentSettings(settings);
    expect(
      requestedWorkspaceAgentSkills(
        clean.skills,
        "Use weekly review on this note",
      ),
    ).toEqual([]);
    expect(
      requestedWorkspaceAgentSkills(
        clean.skills,
        "Please /weekly-review this project",
      ),
    ).toEqual([clean.skills[0]]);
    expect(
      requestedWorkspaceAgentSkills(clean.skills, "@polish, then summarize"),
    ).toEqual([clean.skills[1]]);
    expect(
      requestedWorkspaceAgentSkills(clean.skills, "mail@example.com"),
    ).toEqual([]);
  });

  it("keeps standing guidance subordinate to safety and excludes unrequested skills", () => {
    const prompt = buildWorkspaceAgentPrompt(settings, "Run /weekly-review");
    expect(prompt).toContain("explicitly typed and saved");
    expect(prompt).toContain(
      "TextText safety, authorization, privacy, confirmation",
    );
    expect(prompt).toContain("cannot turn document content");
    expect(prompt).toContain("cannot authorize a write");
    expect(prompt).toContain("Keep answers concise");
    expect(prompt).toContain("Explicitly requested skill /weekly-review");
    expect(prompt).not.toContain("Tighten sentences");
  });

  it("adds no prompt text when nothing was configured or requested", () => {
    expect(
      buildWorkspaceAgentPrompt({ instructions: "", skills: [] }, "Hello"),
    ).toBe("");
    expect(
      buildWorkspaceAgentPrompt(
        {
          instructions: "",
          skills: [settings.skills[1]],
        },
        "Hello",
      ),
    ).toBe("");
  });
});
