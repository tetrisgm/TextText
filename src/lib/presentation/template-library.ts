import {
  validateTemplateDefinition,
  type TemplateDefinition,
} from "@/lib/presentation/schema";

type TemplateLibraryScope = "texttext" | "personal" | "workspace";

export type TemplateLibraryVersion = {
  definition: TemplateDefinition;
  createdAt: string | null;
};

export type TemplateLibraryImpact = {
  itemCount: number;
  folderCount: number;
  folderNames: string[];
};

export type TemplateLibraryEntry = {
  definition: TemplateDefinition;
  scope: TemplateLibraryScope;
  createdAt: string | null;
  versions: TemplateLibraryVersion[];
  impact: TemplateLibraryImpact;
};

export type TemplateLibraryFilter = "all" | TemplateLibraryScope;

const TEMPLATE_IMPORT_MAX_BYTES = 1_000_000;

export function filterTemplateLibrary(
  entries: readonly TemplateLibraryEntry[],
  query: string,
  filter: TemplateLibraryFilter,
): TemplateLibraryEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (filter !== "all" && entry.scope !== filter) return false;
    if (!needle) return true;
    const template = entry.definition;
    const haystack = [
      template.name,
      template.description ?? "",
      template.collection.layout,
      template.theme.typography ?? "",
      ...template.fields.map((field) => field.label),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(needle);
  });
}

type LookExport = {
  format: "texttext-look";
  formatVersion: 1;
  template: TemplateDefinition;
};

export function serializeTemplateLook(template: TemplateDefinition): string {
  const payload: LookExport = {
    format: "texttext-look",
    formatVersion: 1,
    template: validateTemplateDefinition(template),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function parseTemplateLook(text: string): TemplateDefinition {
  if (new TextEncoder().encode(text).byteLength > TEMPLATE_IMPORT_MAX_BYTES) {
    throw new Error("That look file is larger than 1 MB.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("That file does not contain a TextText look.");
  }
  const record = value as Record<string, unknown>;
  const candidate =
    record.format === "texttext-look" && record.formatVersion === 1
      ? record.template
      : value;
  try {
    return validateTemplateDefinition(candidate);
  } catch {
    throw new Error("That file contains an invalid or unsupported look.");
  }
}

export function safeTemplateFilename(name: string): string {
  const slug = name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${slug || "texttext-look"}.texttext-look.json`;
}
