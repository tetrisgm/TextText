import { expect, it } from "vitest";
import { addedContextBlock, boundedContextText } from "../context-excerpts";
it("bounds escaped source text and marks per-item truncation", () => {
  expect(boundedContextText("<&>".repeat(4000), 100)).toHaveLength(100);
  const body = "x".repeat(6001);
  const block = addedContextBlock([{ id: "id", title: "Title", body, origin: "person" }]);
  expect(block).toContain("x".repeat(6000));
  expect(block).not.toContain(body);
  expect(block).toContain("Body excerpt shortened");
  expect(block).toContain("origin: person");
});
it("never describes automatic context as requested by the writer", () => {
  const block = addedContextBlock([{ id: "id", title: "Title", body: "Entire short body" }]);
  expect(block).toContain("added automatically");
  expect(block).not.toContain("explicitly added");
  expect(block).not.toContain("Body excerpt shortened");
});
