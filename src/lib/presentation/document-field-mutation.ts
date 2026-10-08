import { documentFieldValueSchema, type DocumentFieldValue } from "@/lib/documents/model";
import type { TemplateDefinition } from "./schema";

type Field = TemplateDefinition["fields"][number];
/** Validate only changed fields; an unrelated legacy value never blocks an edit. */
export function validateDocumentFieldMutation(template: TemplateDefinition, changes: Record<string, DocumentFieldValue | null>): void {
  const declared = new Map(template.fields.map(field => [field.id, field]));
  for (const [id, value] of Object.entries(changes)) {
    const field = declared.get(id);
    if (!field || /^(?:texttext|textText|__)/.test(id)) throw new Error(`Field "${id}" is not an editable template field.`);
    documentFieldValueSchema.parse(value);
    validate(field, value);
  }
}
function validate(field: Field, value: DocumentFieldValue | null): void {
  // Drafts may clear any declared field, as in the shared editor.
  if (value === null) return;
  const invalid = () => { throw new Error(`Invalid value for template field "${field.id}".`); };
  switch (field.type) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) invalid();
      return;
    case "boolean": if (typeof value !== "boolean") invalid(); return;
    case "enum": {
      const values = field.multiple ? value : [value];
      if (!Array.isArray(values) || values.some(item => typeof item !== "string" || !field.options.some(option => option.value === item))) invalid();
      return;
    }
    case "rows":
      if (!Array.isArray(value) || value.length > field.maxRows) return invalid();
      for (const row of value) {
        if (!row || typeof row !== "object" || Array.isArray(row)) return invalid();
        for (const [id, cell] of Object.entries(row)) {
          const subfield = field.fields.find(candidate => candidate.id === id);
          if (!subfield) return invalid();
          validate(subfield, cell);
        }
      }
      return;
    case "reference":
      if (field.multiple ? !Array.isArray(value) || value.some(item => typeof item !== "string") : typeof value !== "string") invalid();
      return;
    default:
      if (typeof value !== "string") return invalid();
      if ((field.type === "text" || field.type === "richtext") && field.maxLength !== undefined && value.length > field.maxLength) invalid();
      if (field.type === "date" && value && !Number.isFinite(Date.parse(value))) invalid();
      if (field.type === "url" && value) { try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) invalid(); } catch { invalid(); } }
  }
}
