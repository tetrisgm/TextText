import { describe, expect, it } from "vitest";
import { statusWorkflowOptions } from "@/lib/presentation/workflow";
import type { DocumentFieldDefinition } from "@/lib/presentation/schema";

const statusField: Extract<DocumentFieldDefinition, { type: "enum" }> = {
  id: "status",
  label: "Status",
  type: "enum",
  required: false,
  visibility: "public",
  multiple: false,
  semantic: "status",
  options: [
    { value: "planned", label: "Planned" },
    { value: "active", label: "Active" },
    { value: "done", label: "Done" },
  ],
  workflow: {
    initial: "planned",
    completed: ["done"],
    transitions: [
      { from: "planned", to: "active" },
      { from: "active", to: "done" },
      { from: "done", to: "active" },
    ],
  },
};

describe("statusWorkflowOptions", () => {
  it("offers only the initial state before a workflow starts", () => {
    expect(statusWorkflowOptions(statusField, null)).toMatchObject({
      current: null,
      next: [{ value: "planned", label: "Planned" }],
    });
  });

  it("keeps the current state visible and exposes only valid transitions", () => {
    expect(statusWorkflowOptions(statusField, "active")).toMatchObject({
      current: { value: "active", label: "Active" },
      next: [{ value: "done", label: "Done" }],
    });
  });

  it("preserves an unknown legacy state without unlocking every option", () => {
    expect(statusWorkflowOptions(statusField, "legacy")).toMatchObject({
      current: { value: "legacy", label: "legacy" },
      next: [],
    });
  });

  it("does not constrain ordinary enum fields", () => {
    expect(
      statusWorkflowOptions({ ...statusField, semantic: undefined }, "active"),
    ).toBeNull();
  });
});
