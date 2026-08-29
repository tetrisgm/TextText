import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FieldInput } from "@/components/document/FieldInput";
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
    ],
  },
};

const peopleField: Extract<DocumentFieldDefinition, { type: "reference" }> = {
  id: "people",
  label: "People",
  type: "reference",
  required: false,
  visibility: "public",
  target: "document",
  multiple: true,
  semantic: "people",
};

describe("advanced field inputs", () => {
  it("renders only the current workflow state and valid next states", () => {
    const html = renderToStaticMarkup(
      <FieldInput
        field={statusField}
        value="active"
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('<optgroup label="Current">');
    expect(html).toContain('<option value="active" selected="">Active</option>');
    expect(html).toContain('<optgroup label="Next">');
    expect(html).toContain('<option value="done">Done</option>');
    expect(html).not.toContain('value="planned"');
    expect(html).toContain("Next: Done");
  });

  it("renders selected people with workspace-backed choices and manual fallback", () => {
    const html = renderToStaticMarkup(
      <FieldInput
        field={peopleField}
        value={["ramine"]}
        referenceChoices={[
          { id: "ramine", label: "Ramine Darabiha", description: "Profile" },
          { id: "alex", label: "Alex Smith", description: "Note" },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain("Ramine Darabiha");
    expect(html).toContain("RD");
    expect(html).toContain('aria-label="Remove Ramine Darabiha"');
    // "Change people", not "Choose people": one is already selected, and the
    // summary says so (FieldInput.tsx:486). The test asserted the empty-state
    // wording and had never run to notice.
    expect(html).toContain("Change people");
    expect(html).toContain("Alex Smith");
    expect(html).toContain("Use an ID instead");
    expect(html).toContain('aria-label="Add people by ID"');
  });

  it("keeps people editable by ID when workspace choices are unavailable", () => {
    const html = renderToStaticMarkup(
      <FieldInput field={peopleField} value={[]} onChange={vi.fn()} />,
    );

    expect(html).toContain("No one selected");
    expect(html).toContain("Enter a person or item ID");
    expect(html).not.toContain("Find a workspace item");
  });
});
