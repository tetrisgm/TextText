import { describe, expect, it } from "vitest";
import { compileItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import { assertCompatibleItemTypeFields } from "@/lib/presentation/item-type-update";
import { statusWorkflowOptions } from "@/lib/presentation/workflow";

const status = { id: "status", label: "Status", type: "enum", options: [{ value: "todo", label: "To do" }, { value: "done", label: "Done" }], workflow: { initial: "todo", completed: ["done"], transitions: [{ from: "todo", to: "done" }] } };
function fields(input: unknown[]) {
  return compileItemTypeBlueprint({ name: "Tasks", fields: input, collection: { layout: "list" } }, { id: "tasks" }).fields;
}
function check(base: unknown[], next: unknown[]) { assertCompatibleItemTypeFields(fields(base), fields(next)); }

describe("item type successor compatibility", () => {
  it("renames an option label under its stable id and preserves the workflow for stored todo", () => {
    const next = { ...status, options: [{ value: "todo", label: "Queued" }, status.options[1]] };
    check([status], [next]);
    const field = fields([next]).find((field) => field.id === "status")!;
    if (field.type !== "enum") throw new Error("Expected enum");
    expect(statusWorkflowOptions(field, "todo")).toMatchObject({ current: { value: "todo", label: "Queued" }, next: [{ value: "done" }] });
  });
  it("refuses a stored enum value rename even at the same option position", () => {
    expect(() => check([status], [{ ...status, options: [{ value: "queued", label: "Queued" }, status.options[1]], workflow: { ...status.workflow, initial: "queued", transitions: [{ from: "queued", to: "done" }] } }])).toThrow(/status.*todo.*label/);
  });
  it("refuses removing an option and stranding an existing status", () => {
    expect(() => check([status], [{ ...status, options: [status.options[0]], workflow: undefined }])).toThrow(/status.*done/);
    expect(() => check([status], [{ ...status, workflow: { ...status.workflow, transitions: [] } }])).toThrow(/status.*todo.*next step/);
  });
  it.each([
    [{ id: "sources", label: "Sources", type: "text" }, []],
    [{ id: "sources", label: "Sources", type: "text" }, [{ id: "links", label: "Sources", type: "text" }]],
    [{ id: "sources", label: "Sources", type: "text" }, [{ id: "sources", label: "Sources", type: "rows", fields: [{ id: "url", label: "URL", type: "url" }] }]],
    [status, [{ ...status, multiple: true, workflow: undefined }]],
    [{ id: "sources", label: "Sources", type: "reference", multiple: true }, [{ id: "sources", label: "Sources", type: "reference", multiple: false }]],
    [{ id: "sources", label: "Sources", type: "reference", target: "document" }, [{ id: "sources", label: "Sources", type: "reference", target: "folder" }]],
  ])("refuses incompatible field changes %j", (base, next) => {
    expect(() => check([base], next as unknown[])).toThrow(new RegExp(base.id));
  });
  it.each([
    [[{ id: "link", label: "Link", type: "text" }]],
    [[{ id: "url", label: "URL", type: "number" }]],
  ])("refuses incompatible row subfields %j", (next) => {
    const row = { id: "sources", label: "Sources", type: "rows", fields: [{ id: "url", label: "URL", type: "text" }] };
    expect(() => check([row], [{ ...row, fields: next }])).toThrow(/sources.url/);
  });
  it("checks row enum values and multiplicity", () => {
    const rowStatus = { id: status.id, label: status.label, type: status.type, options: status.options };
    const row = { id: "sources", label: "Sources", type: "rows", fields: [rowStatus] };
    expect(() => check([row], [{ ...row, fields: [{ ...rowStatus, options: [{ value: "queued", label: "Queued" }] }] }])).toThrow(/sources.status.*todo/);
    expect(() => check([row], [{ ...row, fields: [{ ...rowStatus, multiple: true }] }])).toThrow(/sources.status.*multiple/);
  });
  it("allows additive fields, row cells, options, reordered options, and labels", () => {
    const row = { id: "sources", label: "Sources", type: "rows", fields: [{ id: "url", label: "URL", type: "text" }] };
    check([status, row], [{ ...status, label: "Progress", options: [...status.options].reverse().concat([{ value: "later", label: "Later" }]) }, { ...row, fields: [...row.fields, { id: "note", label: "Note", type: "text" }] }, { id: "note", label: "Note", type: "text" }]);
  });
  it("refuses narrowing row schemas and newly required fields", () => {
    const row = { id: "sources", label: "Sources", type: "rows", maxRows: 20, fields: [{ id: "note", label: "Note", type: "text" }] };
    expect(() => check([row], [{ ...row, maxRows: 10 }])).toThrow(/sources.*row limit/);
    expect(() => check([row], [{ ...row, fields: [{ ...row.fields[0], required: true }] }])).toThrow(/sources.note.*required/);
    expect(() => check([], [{ id: "note", label: "Note", type: "text", required: true }])).toThrow(/note.*optional/);
  });
  it("refuses tighter scalar validation that could reject stored values", () => {
    const text = { id: "note", label: "Note", type: "text" };
    const number = { id: "amount", label: "Amount", type: "number" };
    expect(() => check([text], [{ ...text, validation: { maxLength: 10 } }])).toThrow(/note.*length limit/);
    for (const validation of [{ min: 1 }, { max: 10 }, { step: 2 }]) {
      expect(() => check([number], [{ ...number, validation }])).toThrow(/amount.*numbers/);
    }
  });
  it("refuses a newly introduced workflow that traps an existing option", () => {
    expect(() => check([{ ...status, workflow: undefined }], [{ ...status, workflow: { ...status.workflow, transitions: [] } }])).toThrow(/status.*todo.*next step/);
  });

});
