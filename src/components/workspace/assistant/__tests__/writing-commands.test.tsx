import React from "react";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickActionControl } from "../QuickActionControl";
import { NATIVE_QUICK_ACTIONS, QUICK_ACTION_LANGUAGES, continuationReplacement } from "@/lib/ai/quick-actions";
import { createSelectionEnvelope } from "@/lib/ai/selection-envelope";
import { normalizeTags } from "@/lib/tags";

// Exercise the production proposal constructor without mounting the entire
// owner/provider hook or mocking its many unrelated persistence dependencies.
const controller = readFileSync("src/components/workspace/assistant/useNativeAssistant.ts", "utf8");
const proposalSource = controller.slice(controller.indexOf("function quickActionProposal("), controller.indexOf("function proposalEdit("));
const compiled = ts.transpileModule(proposalSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const proposal = new Function("continuationReplacement", "normalizeTags", `${compiled}; return quickActionProposal;`)(continuationReplacement, normalizeTags);
const item = { revision: 3, title: "Draft", excerpt: "", body: "Hello world. Keep this." };
const selection = { field: "body" as const, start: 0, end: 12, text: "Hello world." };

describe("writing command proposal integration", () => {
  it("creates a selection translation with the acknowledged coverage guard", async () => {
    const envelope = await createSelectionEnvelope("item", item, selection);
    expect(proposal({ action: "translate", actionLabel: "Translate", item, itemId: "item", selection: envelope, selectionEnvelope: envelope, text: "Bonjour le monde." })).toMatchObject({
      status: "pending", canApply: true, field: "body", before: "Hello world.", after: "Bonjour le monde.", range: { start: 0, end: 12 }, scope: "selection", selectionEnvelope: envelope,
    });
  });
  it("creates an insertion proposal without replacing the selected text", () => {
    expect(proposal({ action: "continue", actionLabel: "Continue writing", item, itemId: "item", selection, text: " More.\n" })).toMatchObject({
      status: "pending", continuation: true, scope: "field", before: item.body, after: "Hello world. More.\n Keep this.", range: { start: 0, end: item.body.length },
    });
  });
  it("creates no proposal for an empty or whitespace-only answer", () => {
    for (const action of ["translate", "continue"]) {
      expect(proposal({ action, actionLabel: action, item, itemId: "item", selection, text: " \n" })).toBeUndefined();
    }
  });
  it("supports an empty document caret without a replacement selection envelope", () => {
    expect(proposal({ action: "continue", actionLabel: "Continue writing", item: { ...item, body: "" }, itemId: "item", selection: { field: "body", start: 0, end: 0, text: "" }, text: "First line." })).toMatchObject({ before: "", after: "First line.", scope: "field" });
  });
});

describe("writing command controls", () => {
  it("uses a labelled native language menu and passes the choice to the controller", () => {
    const run = vi.fn();
    const action = NATIVE_QUICK_ACTIONS.find((entry) => entry.id === "translate")!;
    const control = QuickActionControl({ action, className: "quickAction", onRun: run });
    const html = renderToStaticMarkup(control);
    expect(html).toContain('aria-label="Translate to a language"');
    for (const language of QUICK_ACTION_LANGUAGES) expect(html).toContain(`value="${language}"`);
    control.props.onChange({ target: { value: "French" } });
    expect(run).toHaveBeenCalledExactlyOnceWith("translate", "French");
  });
  it("keeps ordinary actions as buttons and disables them while generating", () => {
    const action = NATIVE_QUICK_ACTIONS.find((entry) => entry.id === "continue")!;
    const run = vi.fn();
    const control = QuickActionControl({ action, className: "quickAction", onRun: run });
    control.props.onClick();
    expect(run).toHaveBeenCalledExactlyOnceWith("continue");
    expect(renderToStaticMarkup(<QuickActionControl action={action} className="quickAction" disabled onRun={run} />)).toContain('disabled=""');
  });
});
