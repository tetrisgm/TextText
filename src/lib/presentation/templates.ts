import type { TemplateDefinition } from "@/lib/presentation/schema";
import { validateTemplateDefinition } from "@/lib/presentation/schema";

const article = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.article",
  version: 1,
  name: "Article",
  description: "A cover-led editorial page for long-form writing.",
  fields: [{ id: "cover", label: "Cover", type: "image" }],
  capabilities: ["assets", "collaboration", "comments", "publish", "search"],
  theme: { typography: "editorial", measure: "reading", alignment: "center" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      { type: "cover", bind: "content.fields.cover", alt: "content.title", height: "large" },
      {
        type: "masthead",
        gap: "sm",
        children: [
          { type: "byline" },
          { type: "text", bind: "content.title", role: "title", fallback: "Untitled" },
          { type: "text", bind: "content.subtitle", role: "subtitle", showWhen: "content.subtitle" },
          { type: "metadata" },
        ],
      },
      { type: "prose", bind: "content.body" },
    ],
  },
  collection: {
    layout: "cards",
    columns: 3,
    gap: "md",
    sort: [{ field: "updatedAt", direction: "desc" }],
    item: {
      type: "stack",
      gap: "sm",
      children: [
        { type: "cover", bind: "content.fields.cover", alt: "content.title", height: "compact" },
        { type: "text", bind: "content.title", role: "heading", fallback: "Untitled" },
        { type: "text", bind: "content.subtitle", role: "caption", showWhen: "content.subtitle" },
      ],
    },
  },
} as const;

const note = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.note",
  version: 1,
  name: "Note",
  description: "A quiet, immediate writing surface.",
  fields: [],
  capabilities: ["assets", "collaboration", "comments", "search"],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      { type: "text", bind: "content.title", role: "title", fallback: "Untitled" },
      { type: "text", bind: "content.subtitle", role: "subtitle", showWhen: "content.subtitle" },
      { type: "prose", bind: "content.body" },
    ],
  },
  collection: {
    layout: "list",
    columns: 1,
    gap: "sm",
    sort: [{ field: "updatedAt", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        { type: "text", bind: "content.title", role: "heading", fallback: "Untitled" },
        { type: "prose", bind: "content.body" },
      ],
    },
  },
} as const;

const bookmark = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.bookmark",
  version: 1,
  name: "Bookmark",
  description: "A locally captured, image-rich reader page.",
  fields: [
    { id: "cover", label: "Cover", type: "image" },
    { id: "sourceUrl", label: "Original link", type: "url", required: true },
  ],
  capabilities: ["assets", "capture", "collaboration", "comments", "import", "search"],
  theme: { typography: "editorial", measure: "reading", alignment: "center" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      { type: "cover", bind: "content.fields.cover", alt: "content.title", height: "large" },
      {
        type: "masthead",
        gap: "sm",
        children: [
          { type: "metadata" },
          { type: "text", bind: "content.title", role: "title", fallback: "Untitled" },
          { type: "text", bind: "content.subtitle", role: "subtitle", showWhen: "content.subtitle" },
          {
            type: "text",
            bind: "content.fields.sourceUrl",
            href: "content.fields.sourceUrl",
            role: "caption",
            showWhen: "content.fields.sourceUrl",
          },
        ],
      },
      { type: "prose", bind: "content.body" },
    ],
  },
  collection: article.collection,
} as const;

const gallery = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.gallery",
  version: 1,
  name: "Gallery",
  description: "Writing and a media collection side by side.",
  fields: [{ id: "cover", label: "Cover", type: "image" }],
  capabilities: ["assets", "collaboration", "comments", "publish", "search"],
  theme: { typography: "system", measure: "full", alignment: "start", media: "full" },
  item: {
    type: "stack",
    direction: "horizontal",
    gap: "none",
    children: [
      {
        type: "group",
        id: "gallery-copy",
        gap: "md",
        children: [
          { type: "byline" },
          { type: "text", bind: "content.title", role: "title", fallback: "Untitled" },
          { type: "text", bind: "content.subtitle", role: "subtitle", showWhen: "content.subtitle" },
          { type: "prose", bind: "content.body" },
        ],
      },
      { type: "gallery", id: "gallery-media", bind: "content.assets", columns: 1 },
    ],
  },
  collection: article.collection,
} as const;

const talk = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.talk",
  version: 1,
  name: "Video",
  description: "A video stage with an editorial transcript.",
  fields: [
    { id: "cover", label: "Cover", type: "image" },
    { id: "videoUrl", label: "Video", type: "url", required: true },
  ],
  capabilities: ["assets", "collaboration", "comments", "publish", "search"],
  theme: { typography: "system", measure: "reading", alignment: "center" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      { type: "video", bind: "content.fields.videoUrl", alt: "content.title", height: "large" },
      {
        type: "masthead",
        gap: "sm",
        children: [
          { type: "byline" },
          { type: "text", bind: "content.title", role: "title", fallback: "Untitled" },
          { type: "text", bind: "content.subtitle", role: "subtitle", showWhen: "content.subtitle" },
          { type: "metadata" },
        ],
      },
      { type: "prose", bind: "content.body" },
    ],
  },
  collection: article.collection,
} as const;

const definitions = [article, note, bookmark, gallery, talk].map((entry) =>
  validateTemplateDefinition(entry),
);

export const BUILTIN_TEMPLATES: readonly TemplateDefinition[] = Object.freeze(definitions);

const templatesByKey = new Map(
  BUILTIN_TEMPLATES.map((template) => [`${template.id}@${template.version}`, template]),
);

export function templateKey(id: string, version: number): string {
  return `${id}@${version}`;
}

export function getBuiltinTemplate(id: string, version = 1): TemplateDefinition | null {
  return templatesByKey.get(templateKey(id, version)) ?? null;
}

export function requireBuiltinTemplate(id: string, version = 1): TemplateDefinition {
  const template = getBuiltinTemplate(id, version);
  if (!template) throw new Error(`Unknown built-in template ${id}@${version}`);
  return template;
}
