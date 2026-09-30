import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { validateTemplateDefinition } from "@/lib/presentation/schema";

export const FOLDER_PRESETS = [
  { id: "reading", name: "Reading list", source: "texttext.note", layout: "list", columns: 1 },
  { id: "contact", name: "Contact sheet", source: "texttext.gallery", layout: "cards", columns: 4 },
  { id: "reference", name: "Reference index", source: "texttext.note", layout: "index", columns: 1 },
].map((preset) => {
  const base = BUILTIN_TEMPLATES.find((template) => template.id === preset.source)!;
  return validateTemplateDefinition({ ...base, id: `texttext.folder-${preset.id}`, name: preset.name,
    description: `A ${preset.name.toLowerCase()} over the files in this folder.`,
    collection: { ...base.collection, layout: preset.layout, columns: preset.columns, sort: [], filters: [], views: [], defaultView: undefined },
  });
});
