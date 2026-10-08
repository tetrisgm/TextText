import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { templateStarterDocument } from "./template-starter";

describe("custom template creation", () => {
  it("seeds explicit starter writing and fields without copying preview content", () => {
    const source = emptyDocumentSnapshot(); source.content.body = "Private source writing";
    const template = { ...BUILTIN_TEMPLATES.find(value => value.id === "texttext.note")!, starter: { title: "Research", body: "## Findings\n\n## Questions\n\n## Sources", fields: { category: "Research" } } };
    const created = templateStarterDocument(source, template);
    expect(created.content).toMatchObject({ title: "Research", body: template.starter.body, fields: { category: "Research" }, assets: [], tags: [] });
    expect(source.content.body).toBe("Private source writing");
    expect(templateStarterDocument(source, { ...template, starter: undefined }).content.body).toBe("");
    // Edits/reopening use the saved snapshot; seeding never mutates it by reference.
    created.content.body = "User replaces the starter";
    expect(template.starter.body).toContain("Findings");
  });
});
