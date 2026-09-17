import { describe, expect, it } from "vitest";
import { heuristicMap, modelMapper, runFreeTextCommand, type Mapper } from "../free-text-command.server";
import type { WorkspaceToolName } from "../tools";

const READS: WorkspaceToolName[] = ["search", "search_reading", "list_folders", "list_items", "list_reading_sources", "read_item"];
const ALL: WorkspaceToolName[] = [...READS, "create_item", "delete_item"];

describe("heuristicMap", () => {
  it("reads the common sentences without a model", () => {
    expect(heuristicMap("search for rust async", READS)).toMatchObject({ ok: true, plan: { tool: "search", arguments: { query: "rust async" } } });
    expect(heuristicMap("find articles about postgres", READS)).toMatchObject({ ok: true, plan: { tool: "search_reading", arguments: { query: "postgres" } } });
    expect(heuristicMap("list my folders", READS)).toMatchObject({ ok: true, plan: { tool: "list_folders" } });
    expect(heuristicMap("show my feeds", READS)).toMatchObject({ ok: true, plan: { tool: "list_reading_sources" } });
    expect(heuristicMap("list items in notes", READS)).toMatchObject({ ok: true, plan: { tool: "list_items", arguments: { folder_path: "notes" } } });
    expect(heuristicMap("read this", READS, { itemId: "abc" })).toMatchObject({ ok: true, plan: { tool: "read_item", arguments: { id: "abc" } } });
  });

  it("only picks commands the connection has, and leaves the rest to the model", () => {
    expect(heuristicMap("search for rust", ["list_folders"])).toBeNull();
    expect(heuristicMap("write a poem about the sea", READS)).toBeNull();
  });
});

describe("modelMapper", () => {
  it("says what is missing when there is no model and no heuristic", async () => {
    const mapping = await modelMapper(null)({ text: "summarise everything from last week", candidates: READS, context: {} });
    expect(mapping.ok).toBe(false);
    if (!mapping.ok) expect(mapping.reason).toMatch(/AI key/);
  });
});

describe("runFreeTextCommand", () => {
  const mapperFor = (answer: unknown): Mapper => async ({ candidates }) => {
    const { validateForTest } = await import("./free-text-command.helpers");
    return validateForTest(candidates, answer);
  };

  it("runs a read at once and returns the plan for a write unless execute is set", async () => {
    const ran: string[] = [];
    const run = async (tool: WorkspaceToolName, args: Record<string, unknown>) => {
      ran.push(`${tool}:${JSON.stringify(args)}`);
      return { done: true };
    };
    const read = await runFreeTextCommand({ text: "search for x", execute: false, context: {}, candidates: ALL, mapper: modelMapper(null), run });
    expect(read.status).toBe("ran");
    expect(ran).toEqual(['search:{"query":"x"}']);
    const planned = await runFreeTextCommand({ text: "make a note", execute: false, context: {}, candidates: ALL, mapper: mapperFor({ tool: "create_item", arguments: { folder_path: "notes", title: "A note" }, why: "creates" }), run });
    expect(planned.status).toBe("planned");
    expect(ran).toHaveLength(1);
    const executed = await runFreeTextCommand({ text: "make a note", execute: true, context: {}, candidates: ALL, mapper: mapperFor({ tool: "create_item", arguments: { folder_path: "notes", title: "A note" }, why: "creates" }), run });
    expect(executed.status).toBe("ran");
    expect(ran[1]).toContain("create_item");
  });

  it("refuses a command outside the candidates, bad arguments, and null answers", async () => {
    const run = async () => ({});
    const outside = await runFreeTextCommand({ text: "delete it", execute: true, context: {}, candidates: READS, mapper: mapperFor({ tool: "delete_item", arguments: { id: "x" } }), run });
    expect(outside).toMatchObject({ status: "unmapped" });
    if (outside.status === "unmapped") expect(outside.reason).toContain("not a command this connection can run");
    const bad = await runFreeTextCommand({ text: "search", execute: false, context: {}, candidates: READS, mapper: mapperFor({ tool: "search", arguments: {} }), run });
    expect(bad).toMatchObject({ status: "unmapped" });
    if (bad.status === "unmapped") expect(bad.reason).toContain("arguments do not fit");
    const none = await runFreeTextCommand({ text: "??", execute: false, context: {}, candidates: READS, mapper: mapperFor({ tool: null, reason: "Nothing fits" }), run });
    expect(none).toMatchObject({ status: "unmapped", reason: "Nothing fits" });
    const itself = await runFreeTextCommand({ text: "run a command", execute: true, context: {}, candidates: [...READS, "run_command"], mapper: mapperFor({ tool: "run_command", arguments: { text: "x" } }), run });
    expect(itself.status).toBe("unmapped");
  });
});
