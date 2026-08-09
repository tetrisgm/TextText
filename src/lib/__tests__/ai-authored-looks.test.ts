// Can an agent be asked for a new look and actually get one?
//
// The claim is that "make me a Todoist-style board" is one prompt away,
// because a look is validated data rather than code: the agent emits bounded
// operations, the engine rebuilds the whole artifact and revalidates it, and
// anything that would render as HTML, CSS or JavaScript is rejected by the
// schema rather than sanitized later.
//
// This exercises the same path customize_document_template runs, then renders
// the result, so the proof is a rendered document and not a passing parse.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOOL_DEFINITIONS } from "@/lib/ai/tools";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import {
  applyTemplateOperations,
  parseTemplateOperations,
} from "@/lib/presentation/operations";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";

/**
 * What an agent would emit for "give me a Todoist-style look: tasks grouped
 * by project, with a label and a priority, and a board view".
 */
const TODOIST_STYLE = [
  { op: "set-name", name: "Task board" },
  {
    op: "set-description",
    description: "Tasks grouped by project, with labels and priorities.",
  },
  {
    op: "set-fields",
    fields: [
      { id: "project", label: "Project", type: "text" },
      {
        id: "labels",
        label: "Labels",
        type: "enum",
        options: [
          { value: "home", label: "Home", tone: "success" },
          { value: "work", label: "Work", tone: "info" },
        ],
      },
      {
        id: "items",
        label: "Tasks",
        type: "rows",
        fields: [
          { id: "task", label: "Task", type: "text", required: true },
          { id: "done", label: "Done", type: "boolean" },
          { id: "due", label: "Due", type: "date" },
        ],
      },
    ],
  },
  {
    op: "replace-item",
    item: {
      type: "stack",
      gap: "md",
      children: [
        {
          type: "masthead",
          gap: "sm",
          children: [
            {
              type: "text",
              bind: "content.title",
              role: "title",
              fallback: "Untitled board",
            },
            {
              type: "facts",
              variant: "table",
              entries: [{ bind: "content.fields.project", label: "Project" }],
            },
          ],
        },
        {
          type: "checklist",
          bind: "content.fields.items",
          labelBind: "row.task",
          doneBind: "row.done",
        },
      ],
    },
  },
  // The collection view has to be replaced too. Leaving it alone kept a
  // showWhen pointing at the dropped `area` field, and the rebuild refused
  // the whole template rather than shipping a look that half-worked.
  {
    op: "replace-collection-item",
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled board",
        },
        {
          type: "text",
          bind: "content.fields.project",
          role: "caption",
          showWhen: "content.fields.project",
        },
      ],
    },
  },
] as const;

const base = requireBuiltinTemplate("texttext.todo");

function board() {
  const operations = parseTemplateOperations(structuredClone(TODOIST_STYLE));
  return applyTemplateOperations(base, operations);
}

describe("an agent can author a look", () => {
  it("derives a whole new look from a built-in through bounded operations", () => {
    const next = board();
    expect(next.name).toBe("Task board");
    expect(next.fields.map((field) => field.id)).toEqual([
      "project",
      "labels",
      "items",
    ]);
    // The base is untouched: deriving a look never edits the one it came from.
    expect(base.name).toBe("Tasks");
    expect(base.fields.some((field) => field.id === "project")).toBe(false);
  });

  it("renders the derived look as a real document", () => {
    const document = validateDocumentSnapshot({
      schemaVersion: 1,
      content: {
        title: "This week",
        body: "",
        tags: [],
        assets: [],
        fields: {
          project: "Relaunch",
          items: [
            { task: "Draft the brief", done: true },
            { task: "Book the studio", done: false },
          ],
        },
      },
      presentation: {
        template: { id: base.id, version: base.version },
        theme: {},
      },
    });

    const html = renderToStaticMarkup(
      DocumentRenderer({ document, template: board() }),
    );
    expect(html).toContain("This week");
    expect(html).toContain("Relaunch");
    expect(html).toContain("Draft the brief");
    expect(html).toContain("Book the studio");
    // The facts entry the agent asked for arrived as a key/value row.
    expect(html).toContain("Project");
  });

  it("refuses a look that tries to carry markup, styling or script", () => {
    for (const bad of [
      { op: "replace-item", item: { type: "html", value: "<script>x</script>" } },
      { op: "set-theme", theme: { css: ".tt-text{color:red}" } },
      {
        op: "replace-item",
        item: { type: "text", bind: "content.title", role: "title", style: "color:red" },
      },
    ]) {
      expect(() => parseTemplateOperations([bad]), JSON.stringify(bad)).toThrow();
    }
  });

  it("refuses a look that binds a field it never declared", () => {
    // The rebuild revalidates the whole artifact, so an agent cannot leave a
    // template referring to something that does not exist.
    const operations = parseTemplateOperations([
      {
        op: "set-fields",
        fields: [{ id: "project", label: "Project", type: "text" }],
      },
      {
        op: "replace-item",
        item: {
          type: "text",
          bind: "content.fields.nowhere",
          role: "body",
        },
      },
    ]);
    expect(() => applyTemplateOperations(base, operations)).toThrow(
      /undeclared field/i,
    );
  });

  it("will not let a workspace look squat on a reserved built-in id", () => {
    // texttext.* is the built-in namespace; a workspace template that took one
    // would shadow a look every existing document resolves through.
    const tool = WORKSPACE_TOOL_DEFINITIONS.customize_document_template;
    const input = {
      base_template_id: "texttext.todo",
      base_template_version: 1,
      name: "Task board",
      operations: [{ op: "set-name", name: "Task board" }],
    };
    expect(() =>
      tool.inputSchema.parse({ ...input, template_id: "texttext.stolen" }),
    ).toThrow();
    expect(() =>
      tool.inputSchema.parse({ ...input, template_id: "acme.board" }),
    ).not.toThrow();
  });
});
