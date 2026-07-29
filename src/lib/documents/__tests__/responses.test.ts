// Poll semantics: option labels come from the document's rows, closing is
// fail-open on bad dates, and submissions validate against the live ballot.

import { describe, expect, it } from "vitest";
import { validateDocumentSnapshot } from "../model";
import {
  findPollNode,
  pollClosed,
  pollOptionLabels,
  validatePollSubmission,
} from "../responses";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";

const pollTemplate = requireBuiltinTemplate("texttext.poll");

const snapshot = (fields: Record<string, unknown>) =>
  validateDocumentSnapshot({
    schemaVersion: 1,
    content: { title: "Team lunch", body: "", fields, tags: [], assets: [] },
    presentation: { template: { id: "texttext.poll", version: 1 }, theme: {} },
  });

describe("findPollNode", () => {
  it("finds the poll bound to the options field", () => {
    const node = findPollNode(pollTemplate, "options");
    expect(node?.type).toBe("poll");
    expect(node?.labelBind).toBe("row.option");
  });

  it("returns null for a field without a poll", () => {
    expect(findPollNode(pollTemplate, "closesAt")).toBeNull();
  });
});

describe("pollOptionLabels", () => {
  const poll = findPollNode(pollTemplate, "options")!;

  it("reads labels in document order, trimmed and deduplicated", () => {
    const document = snapshot({
      options: [
        { option: " Ramen " },
        { option: "Tacos" },
        { option: "Ramen" },
        { option: "" },
      ],
    });
    expect(pollOptionLabels(document, poll)).toEqual(["Ramen", "Tacos"]);
  });

  it("returns nothing when the field is unset", () => {
    expect(pollOptionLabels(snapshot({}), poll)).toEqual([]);
  });
});

describe("pollClosed", () => {
  const poll = findPollNode(pollTemplate, "options")!;

  it("closes after the bound date and stays open before it", () => {
    const document = snapshot({ options: [{ option: "A" }], closesAt: "2026-07-20" });
    expect(pollClosed(document, poll, new Date("2026-07-21"))).toBe(true);
    expect(pollClosed(document, poll, new Date("2026-07-19"))).toBe(false);
  });

  it("stays open when the close date is unset or unparsable", () => {
    expect(pollClosed(snapshot({ options: [{ option: "A" }] }), poll, new Date())).toBe(false);
    expect(
      pollClosed(
        snapshot({ options: [{ option: "A" }], closesAt: "not a date" }),
        poll,
        new Date(),
      ),
    ).toBe(false);
  });
});

describe("validatePollSubmission", () => {
  const labels = ["Ramen", "Tacos", "Pizza"];

  it("accepts a single valid choice", () => {
    expect(validatePollSubmission({ labels, values: ["Tacos"], multiple: false })).toBeNull();
  });

  it("rejects two choices on a single-choice poll", () => {
    expect(
      validatePollSubmission({ labels, values: ["Tacos", "Pizza"], multiple: false }),
    ).toMatch(/one choice/);
  });

  it("accepts several distinct choices when multiple", () => {
    expect(
      validatePollSubmission({ labels, values: ["Tacos", "Pizza"], multiple: true }),
    ).toBeNull();
  });

  it("rejects off-ballot values, duplicates, and empty submissions", () => {
    expect(validatePollSubmission({ labels, values: ["Sushi"], multiple: true })).toMatch(
      /not on this poll/,
    );
    expect(
      validatePollSubmission({ labels, values: ["Tacos", "Tacos"], multiple: true }),
    ).toMatch(/Duplicate/);
    expect(validatePollSubmission({ labels, values: [], multiple: true })).toMatch(/at least/);
    expect(validatePollSubmission({ labels: [], values: ["A"], multiple: false })).toMatch(
      /no options/,
    );
  });
});
