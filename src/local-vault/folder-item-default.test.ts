import { expect, it } from "vitest";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { folderStarter } from "./folder-item-default";
it("preserves starter text and styling but honors explicit empty writing and field overrides", () => {
  const template = { ...requireBuiltinTemplate("texttext.note"), starter: { title: "Starter", body: "Body", fields: { texttextNoteColor: "blue", texttextNoteIcon: "🌱" } } };
  expect(folderStarter(template, {})).toEqual(template.starter);
  expect(folderStarter(template, { title: "", body: "", fields: { texttextNoteColor: "default" } })).toEqual({ title: "", body: "", fields: { texttextNoteColor: "default", texttextNoteIcon: "🌱" } });
});
