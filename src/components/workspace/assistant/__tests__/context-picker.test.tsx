import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantContextPicker, AssistantContextSearch, contextItemChoices } from "../AssistantContextPicker";
import { DEFAULT_CONTEXT_CHOICE } from "@/lib/ai/context-choice";
const items = Array.from({ length: 6 }, (_, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, name: `Note ${i}`, detail: i === 2 ? "Research / Summer" : "Notes" }));
describe("next-turn context picker", () => {
  it("renders named toggle and removal chips and disables Add at five", () => {
    const html = renderToStaticMarkup(<AssistantContextPicker items={items}
      choice={{ ...DEFAULT_CONTEXT_CHOICE, itemIds: items.slice(0, 5).map((item) => item.id) }}
      hasItem hasSelection onChange={() => {}} focusComposer={() => {}} />);
    expect(html).toContain('aria-label="Context for the next turn"');
    expect(html).toContain('aria-pressed="true">This item');
    expect(html).toContain('aria-pressed="true">Selection');
    expect(html).toContain('Whole workspace index');
    expect(html.match(/aria-label="Remove context Note/g)).toHaveLength(5);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Add TextText context"/);
  });
  it("labels the combobox and listbox and exposes named choices", () => {
    const html = renderToStaticMarkup(<AssistantContextSearch items={items} selected={[items[0].id]} onAdd={() => {}} onClose={() => {}} />);
    expect(html).toContain('role="combobox" aria-label="Search TextText items by title or folder"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('role="listbox" aria-label="Matching TextText items"');
    expect(html).toContain('role="option" aria-selected="true"');
    expect(html).not.toContain('<span>Note 0</span>');
  });
  it("searches titles and folders, excludes chosen items, and bounds visible results", () => {
    expect(contextItemChoices(items, [], "  SUMMER ")).toEqual([items[2]]);
    expect(contextItemChoices(items, [items[2].id], "SUMMER")).toEqual([]);
    expect(contextItemChoices(items, [], "note 4")).toEqual([items[4]]);
    expect(contextItemChoices([...items, ...items], [], "")).toHaveLength(8);
  });
  it("does not claim an item or selection at the workspace root", () => {
    const html = renderToStaticMarkup(<AssistantContextPicker items={[]} choice={DEFAULT_CONTEXT_CHOICE}
      hasItem={false} hasSelection={false} onChange={() => {}} focusComposer={() => {}} />);
    expect(html).not.toContain('>This item<'); expect(html).not.toContain('>Selection<');
    expect(html).toContain('>Add<');
  });
});
