import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DocumentRenderer,
  formatFieldValue,
} from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import {
  validateTemplateDefinition,
  type DocumentFieldDefinition,
} from "@/lib/presentation/schema";

const template = validateTemplateDefinition({
  schemaVersion: 1,
  engineVersion: 1,
  id: "test.render-nodes",
  version: 1,
  name: "Render nodes",
  fields: [
    {
      id: "status",
      label: "Status",
      type: "enum",
      options: [
        { value: "planned", label: "Planned", tone: "neutral" },
        { value: "shipped", label: "Shipped", tone: "success", icon: "🚀" },
      ],
    },
    { id: "team", label: "Team", type: "text" },
    { id: "ratio", label: "Ratio", type: "number" },
    { id: "current", label: "Current", type: "number" },
    { id: "goal", label: "Goal", type: "number" },
    { id: "pitch", label: "Pitch", type: "text" },
    { id: "speaker", label: "Speaker", type: "text" },
    {
      id: "tasks",
      label: "Tasks",
      type: "rows",
      fields: [
        { id: "label", label: "Task", type: "text" },
        { id: "done", label: "Done", type: "boolean" },
        { id: "minutes", label: "Minutes", type: "number", format: "minutes" },
        { id: "stars", label: "Stars", type: "number", format: "rating", max: 5 },
      ],
    },
  ],
  item: {
    type: "stack",
    children: [
      { type: "badge", bind: "content.fields.status" },
      {
        type: "facts",
        variant: "table",
        entries: [
          { bind: "content.fields.team", label: "Team" },
          { bind: "content.subtitle", label: "Subtitle" },
        ],
      },
      {
        type: "checklist",
        bind: "content.fields.tasks",
        doneBind: "row.done",
        labelBind: "row.label",
        rollup: true,
      },
      {
        type: "rows",
        bind: "content.fields.tasks",
        variant: "table",
        columns: [
          { bind: "row.label", label: "Task" },
          { bind: "row.minutes" },
          { bind: "row.stars" },
        ],
      },
      {
        id: "progress-plain",
        type: "progress",
        variant: "bar",
        source: { bind: "content.fields.ratio" },
      },
      {
        id: "progress-pair",
        type: "progress",
        variant: "fraction",
        source: {
          currentBind: "content.fields.current",
          targetBind: "content.fields.goal",
        },
      },
      {
        id: "progress-rollup",
        type: "progress",
        variant: "ring",
        source: { checklistBind: "content.fields.tasks", doneBind: "row.done" },
      },
      {
        type: "quote",
        bind: "content.fields.pitch",
        variant: "attributed",
        attributionBind: "content.fields.speaker",
      },
      {
        type: "callout",
        tone: "warning",
        title: "Heads up",
        children: [{ type: "text", bind: "content.fields.team", role: "body" }],
      },
    ],
  },
  collection: {
    layout: "list",
    item: { type: "text", bind: "content.title", role: "heading" },
  },
});

function makeDocument(fields: Record<string, unknown>): DocumentSnapshot {
  return {
    schemaVersion: 1,
    content: {
      title: "Doc",
      subtitle: "",
      body: "",
      fields,
      tags: [],
      assets: [],
    },
    presentation: {
      template: { id: "test.render-nodes", version: 1 },
      theme: {},
    },
  } as unknown as DocumentSnapshot;
}

const baseFields = {
  status: "shipped",
  team: "Platform",
  ratio: 1.4,
  current: 3,
  goal: 7,
  pitch: "Make it obvious.",
  speaker: "Sam Carter",
  tasks: [
    { label: "Draft spec", done: true, minutes: 90, stars: 3.5 },
    { label: "Build renderer", done: false, minutes: 30 },
    { label: "Ship", done: false },
  ],
};

function render(fields: Record<string, unknown> = baseFields): string {
  return renderToStaticMarkup(
    React.createElement(DocumentRenderer, {
      document: makeDocument(fields),
      template,
    }),
  );
}

describe("badge", () => {
  it("resolves the enum option tone, label, and icon", () => {
    const html = render();
    expect(html).toContain("tt-tone-success");
    expect(html).toContain("Shipped");
    expect(html).toContain("🚀");
  });

  it("falls back to a neutral pill for an unknown option value", () => {
    const html = render({ ...baseFields, status: "mystery" });
    expect(html).toContain('<span class="tt-pill tt-tone-neutral">mystery</span>');
  });
});

describe("facts", () => {
  it("skips entries whose value is empty", () => {
    const html = render();
    expect(html).toContain("<dt>Team</dt>");
    expect(html).toContain("<dd>Platform</dd>");
    expect(html).not.toContain("Subtitle");
  });
});

describe("checklist", () => {
  it("moves done rows last and reports the rollup", () => {
    const html = render();
    expect(html).toContain("1 of 3");
    const done = html.indexOf("Draft spec");
    const undone = html.indexOf("Build renderer");
    expect(undone).toBeGreaterThan(-1);
    expect(done).toBeGreaterThan(-1);
    // The checklist renders before the rows table; compare inside its markup
    // (class names also appear in the inline stylesheet, so anchor on class=).
    const checklist = html.slice(
      html.indexOf('class="tt-checklist"'),
      html.indexOf('class="tt-rows '),
    );
    expect(checklist.indexOf("Build renderer")).toBeLessThan(checklist.indexOf("Draft spec"));
  });
});

describe("rows table", () => {
  it("formats number cells by their field format", () => {
    const html = render();
    expect(html).toContain("1 h 30 m");
    expect(html).toContain("30 m");
    expect(html).toContain("★★★½☆");
    expect(html).toContain(">Task</th>");
  });
});

describe("progress", () => {
  it("clamps a plain ratio above 1 to 100", () => {
    const html = render();
    expect(html).toMatch(/data-tt-node="progress-plain"[^>]*aria-valuenow="100"/);
  });

  it("clamps a negative ratio to 0", () => {
    const html = render({ ...baseFields, ratio: -0.5 });
    expect(html).toMatch(/data-tt-node="progress-plain"[^>]*aria-valuenow="0"/);
  });

  it("computes current over target and renders the fraction", () => {
    const html = render();
    expect(html).toMatch(/data-tt-node="progress-pair"[^>]*aria-valuenow="43"/);
    expect(html).toContain("3 of 7");
  });

  it("rolls up a checklist into done over total", () => {
    const html = render();
    expect(html).toMatch(/data-tt-node="progress-rollup"[^>]*aria-valuenow="33"/);
  });
});

describe("quote", () => {
  it("renders the attribution line", () => {
    const html = render();
    expect(html).toContain("Make it obvious.");
    expect(html).toContain("tt-quote-attribution");
    expect(html).toContain("Sam Carter");
  });
});

describe("callout", () => {
  it("renders the tone class and title", () => {
    const html = render();
    expect(html).toContain("tt-callout-warning");
    expect(html).toContain("Heads up");
  });
});

describe("formatFieldValue", () => {
  const numberField = (
    format: "plain" | "currency" | "percent" | "minutes" | "rating",
    max?: number,
  ): DocumentFieldDefinition =>
    ({
      id: "n",
      label: "N",
      type: "number",
      required: false,
      visibility: "public",
      format,
      ...(max != null ? { max } : {}),
    }) as DocumentFieldDefinition;

  it("formats minutes", () => {
    expect(formatFieldValue(90, numberField("minutes"))).toBe("1 h 30 m");
    expect(formatFieldValue(60, numberField("minutes"))).toBe("1 h");
    expect(formatFieldValue(25, numberField("minutes"))).toBe("25 m");
  });

  it("formats percent from a 0..1 value", () => {
    expect(formatFieldValue(0.5, numberField("percent"))).toBe("50%");
  });

  it("formats ratings as stars against max", () => {
    expect(formatFieldValue(2, numberField("rating", 5))).toBe("★★☆☆☆");
    expect(formatFieldValue(4.5, numberField("rating", 5))).toBe("★★★★½");
  });

  it("groups currency values", () => {
    expect(formatFieldValue(12345.5, numberField("currency"))).toBe("12,345.5");
  });
});
