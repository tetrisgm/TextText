import { z } from "zod";
import { themeTokensSchema } from "@/lib/presentation/schema";

export const DOCUMENT_SCHEMA_VERSION = 1 as const;

export const documentAssetSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    kind: z.enum(["image", "video", "audio", "file"]),
    src: z.string().trim().min(1).max(4096),
    alt: z.string().max(1000).optional(),
    caption: z.string().max(4000).optional(),
    contentType: z.string().trim().max(200).optional(),
    width: z.number().int().positive().max(100_000).optional(),
    height: z.number().int().positive().max(100_000).optional(),
  })
  .strict();

export type DocumentAsset = z.infer<typeof documentAssetSchema>;

const rowScalarSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/** One row of a `rows` field: sub-field id to scalar. Rows nest exactly one
 * level, by design: a row is a record, not a document. */
export const documentFieldRowSchema = z.record(
  z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/),
  rowScalarSchema,
);

export const documentFieldValueSchema = z.union([
  z.string().max(2_000_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(20_000)).max(500),
  z.array(documentFieldRowSchema).max(500),
]);

export type DocumentFieldRow = z.infer<typeof documentFieldRowSchema>;

export type DocumentFieldValue = z.infer<typeof documentFieldValueSchema>;

export const documentContentSchema = z
  .object({
    title: z.string().max(20_000).default(""),
    subtitle: z.string().max(100_000).optional(),
    body: z.string().max(10_000_000).default(""),
    fields: z.record(z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/), documentFieldValueSchema).default({}),
    tags: z.array(z.string().trim().min(1).max(120)).max(500).default([]),
    assets: z.array(documentAssetSchema).max(2_000).default([]),
  })
  .strict();

export type DocumentContent = z.infer<typeof documentContentSchema>;

export const templateReferenceSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    version: z.number().int().positive(),
  })
  .strict();

export type TemplateReference = z.infer<typeof templateReferenceSchema>;

export const documentThemeSchema = themeTokensSchema;

export type DocumentTheme = z.infer<typeof documentThemeSchema>;

export const documentPresentationSchema = z
  .object({
    template: templateReferenceSchema,
    theme: documentThemeSchema.default({}),
  })
  .strict();

export type DocumentPresentation = z.infer<typeof documentPresentationSchema>;

export const documentVisibilitySchema = z.enum(["private", "link", "public"]);
export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;

export const documentSnapshotSchema = z
  .object({
    schemaVersion: z.literal(DOCUMENT_SCHEMA_VERSION),
    content: documentContentSchema,
    presentation: documentPresentationSchema,
  })
  .strict();

export type DocumentSnapshot = z.infer<typeof documentSnapshotSchema>;

export function validateDocumentSnapshot(value: unknown): DocumentSnapshot {
  return documentSnapshotSchema.parse(value);
}

export function requireDocumentSnapshot(
  value: unknown,
  context = "Persisted item",
): DocumentSnapshot {
  if (value == null) {
    throw new Error(`${context} is missing its canonical document`);
  }
  return validateDocumentSnapshot(value);
}

export function emptyDocumentSnapshot(
  template: TemplateReference = { id: "texttext.article", version: 1 },
): DocumentSnapshot {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    content: {
      title: "",
      body: "",
      fields: {},
      tags: [],
      assets: [],
    },
    presentation: { template, theme: {} },
  };
}

export function documentIsEmpty(document: DocumentSnapshot): boolean {
  const { content } = document;
  return (
    content.title.trim() === "" &&
    (content.subtitle?.trim() ?? "") === "" &&
    content.body.trim() === "" &&
    Object.keys(content.fields).length === 0 &&
    content.assets.length === 0
  );
}
