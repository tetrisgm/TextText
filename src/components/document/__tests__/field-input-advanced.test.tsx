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

const imageField: Extract<DocumentFieldDefinition, { type: "image" }> = {
  id: "cover",
  label: "Cover",
  type: "image",
  required: false,
  visibility: "public",
  allowedContentTypes: [],
};

describe("advanced field inputs", () => {
  it("uses the resolved asset only for the image preview", () => {
    const html = renderToStaticMarkup(
      <FieldInput
        field={imageField}
        value="assets/cover.png"
        imagePreviewSource="blob:local-cover"
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('class="tt-image-field-preview" src="blob:local-cover"');
    expect(html).toContain('value="assets/cover.png"');
    expect(html).not.toContain('src="assets/cover.png"');
  });

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

it("renders parent choices by authorized title while retaining unavailable references privately", () => {
  const field: DocumentFieldDefinition = { id: "parents", label: "Parents", type: "reference", target: "document", multiple: true, required: false, visibility: "public" };
  const html = renderToStaticMarkup(<FieldInput field={field} value={["hidden-id", "known-id"]} referenceChoices={[{id:"known-id",label:"Known parent"},{id:"next-id",label:"Another note"}]} onChange={() => {}} />);
  expect(html).toContain("Known parent");
  expect(html).toContain("Unavailable item");
  expect(html).toContain("Add parent");
  expect(html).toContain("Another note");
  expect(html).not.toContain("hidden-id");
  expect(html).not.toContain("comma separated");
});

it("offers navigation only for parent identities available in the authorized choices", () => {
  const field: DocumentFieldDefinition = { id: "parents", label: "Parents", type: "reference", target: "document", multiple: true, required: false, visibility: "public" };
  const html = renderToStaticMarkup(<FieldInput field={field} value={["known","missing"]} referenceChoices={[{id:"known",label:"Parent title"}]} onOpenReference={() => {}} onChange={() => {}} />);
  expect(html).toContain('<button type="button">Parent title</button>');
  expect(html).toContain('<span>Unavailable item</span>');
  expect(html).not.toContain('>missing<');
});
