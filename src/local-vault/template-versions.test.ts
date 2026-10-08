import { expect, it } from "vitest";
import { latestTemplateVersions } from "./template-versions";
it("offers the latest identity version without losing pinned definitions or collapsing same names", () => {
  const old = { path: "Templates/old.textpack", template: { id: "custom.a", version: 1, name: "Same name" } };
  const latest = { path: "Templates/new.textpack", template: { id: "custom.a", version: 2, name: "Same name" } };
  const other = { path: "Templates/other.textpack", template: { id: "custom.b", version: 1, name: "Same name" } };
  const all = [old, other, latest];
  expect(latestTemplateVersions(all)).toEqual([latest, other]);
  expect(all.find(look => look.template.id === "custom.a" && look.template.version === 1)).toBe(old);
  expect(all).toHaveLength(3);
});
it("chooses deterministically when user-created duplicate versions arrive in a different order", () => {
  const a = { path: "Templates/a.textpack", template: { id: "custom.a", version: 2 } };
  const b = { path: "Templates/b.textpack", template: { id: "custom.a", version: 2 } };
  expect(latestTemplateVersions([b, a])).toEqual([a]);
  expect(latestTemplateVersions([a, b])).toEqual([a]);
});
