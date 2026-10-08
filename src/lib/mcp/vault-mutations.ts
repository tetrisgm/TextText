import { createHash, randomUUID } from "node:crypto";
import { mutateVaultDocument, writeVaultTextpack } from "@/lib/store";
import { type DocumentMutation } from "@/lib/collab/document";
import { captureIntent } from "@/lib/capture-intent";
import { parsePostMarkdownFile } from "@/lib/markdown-files";
import { mergeMarkdownIntoDocument } from "@/lib/documents/sync";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { buildTextpack } from "@/lib/github/textpack";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";

export type VaultMutationContext = {
  receiptOnly?: boolean;
  root: string; workspaceId: string; actorUserId: string; actorType?: "human" | "external_agent";
  authorizeTemplate?: (itemId: string, path: string) => Promise<void>;
  authorize: (itemId: string, path: string, creating: boolean) => Promise<void>;
};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function only(args: Record<string, unknown>, keys: readonly string[]) {
  const unsupported = Object.keys(args).filter((key) => !keys.includes(key));
  if (unsupported.length) throw new Error(`Unsupported file command fields: ${unsupported.join(", ")}`);
}
export async function mutateVaultTool(name: string, args: Record<string, unknown>, context: VaultMutationContext) {
  const location = { receiptOnly: context.receiptOnly, root: context.root, workspaceId: context.workspaceId };
  const operationId = typeof args.idempotency_key === "string"
    ? digest(`${context.actorUserId}:${name}:${args.idempotency_key}`) : randomUUID();
  if (name === "add_item_asset") {
    only(args, ["id", "source_url", "placement", "alt_text", "caption", "if_match_hash", "idempotency_key"]);
    if (typeof args.id !== "string" || typeof args.source_url !== "string" || typeof args.if_match_hash !== "string" || typeof args.idempotency_key !== "string" || !args.idempotency_key.trim() || !["cover", "body_end", "gallery"].includes(String(args.placement))) throw new Error("Choose an image, placement, current hash and stable idempotency key.");
    const { preparePublicImage } = await import("@/lib/vault/image-fetch");
    const itemId = args.id;
    await context.authorize(itemId, "", false);
    return mutateVaultDocument({ ...location, itemId, operationId, expectedRevision: args.if_match_hash, mutation: {},
      attachment: { request: { sourceUrl: args.source_url, placement: args.placement as "cover" | "body_end" | "gallery", ...(typeof args.alt_text === "string" ? { altText: args.alt_text } : {}), ...(typeof args.caption === "string" ? { caption: args.caption } : {}) }, prepare: () => preparePublicImage(args.source_url as string) },
      actorUserId: context.actorUserId, actorType: context.actorType ?? "external_agent", beforeCommit: path => context.authorize(itemId, path, false) });
  }
  if (name === "create_item") {
    only(args, ["title", "body", "excerpt", "kind", "fields", "folder_path", "idempotency_key", "capture", "markdown", "template_id", "template_version"]);
    if (args.template_version !== undefined && args.template_id === undefined) throw new Error("template_version requires template_id");
    const capture = typeof args.capture === "string" ? captureIntent(args.capture) : null;
    const rawMarkdown = typeof args.markdown === "string" ? args.markdown.replace(/^\uFEFF/, "") : null;
    if ((capture || rawMarkdown !== null) && ["title", "body", "excerpt", "kind", "fields"].some(key => args[key] !== undefined) || capture && rawMarkdown !== null) throw new Error("Use capture, markdown, or structured fields separately.");
    const parsed = rawMarkdown !== null ? parsePostMarkdownFile(rawMarkdown) : null;
    if (parsed?.fields.status === "published") throw new Error("New files are private. Publish separately after review.");
    const parsedKind = parsed?.fields.type === "video_post" ? "talk" : parsed?.fields.type === "media_post" ? "gallery" : parsed?.fields.type;
    const kind = capture?.kind ?? parsedKind ?? (typeof args.kind === "string" ? args.kind : "note");
    if (!["note", "article", "bookmark", "gallery", "talk"].includes(kind)) throw new Error("Unsupported item kind.");
    const template = requireBuiltinTemplate(`texttext.${kind}`);
    let document = emptyDocumentSnapshot({ id: template.id, version: template.version });
    document.content.title = typeof args.title === "string" ? args.title : "Untitled";
    document.content.body = typeof args.body === "string" ? args.body : "";
    if (typeof args.excerpt === "string") document.content.subtitle = args.excerpt;
    if (args.fields && typeof args.fields === "object") document.content.fields = args.fields as typeof document.content.fields;
    if (parsed) document = mergeMarkdownIntoDocument(document, parsed);
    if (capture) {
      document.content.title = capture.title;
      document.content.body = capture.body;
      if (capture.sourceUrl) {
        const source = new URL(capture.sourceUrl);
        if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) throw new Error("Use a public HTTP or HTTPS URL without credentials.");
        document.content.fields.sourceUrl = source.href;
      }
    }
    const seed = digest(operationId);
    const itemId = `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-8${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
    const folder = typeof args.folder_path === "string" ? args.folder_path : ({ note: "Notes", article: "Blog", bookmark: "Bookmarks", gallery: "Gallery", talk: "Presentations" }[kind]);
    if (folder && folder.split("/").some((part) => !part || part === "." || part === "..") || /[\\\x00]/.test(folder ?? "")) throw new Error("Invalid folder.");
    const title = document.content.title.replace(/[\/\\:*?"<>|\x00-\x1f]/g, " ").trim().slice(0, 80) || "Untitled";
    const relativePath = `${folder ? `${folder}/` : ""}${title}-${itemId.slice(0, 8)}.textpack`;
    // A selected template may determine the final folder/title under the lock.
    // Authorize that resolved destination in beforeCommit, not this draft path.
    if (typeof args.template_id !== "string") await context.authorize(itemId, relativePath, true);
    // Preserve supplied frontmatter verbatim, replacing only the new file identity.
    const frontmatter = rawMarkdown?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const markdown = frontmatter
      ? rawMarkdown!.replace(frontmatter[0], `---\ntextTextId: ${itemId}\n${frontmatter[1].split(/\r?\n/).filter(line => !/^textTextId\s*:/.test(line)).join("\n")}\n---\n`)
      : `---\ntextTextId: ${itemId}\ntitle: ${JSON.stringify(document.content.title)}\n---\n\n${document.content.body}`;
    return writeVaultTextpack({ ...location, itemId, operationId, relativePath, baseRevision: null,
      bytes: buildTextpack("Document", { document, markdown, template }), actorUserId: context.actorUserId, actorType: context.actorType ?? "external_agent",
      ...(typeof args.template_id === "string" ? { templateCreation: { id: args.template_id,
        ...(typeof args.template_version === "number" ? { version: args.template_version } : {}),
        titleDefault: !capture && !parsed && args.title === undefined,
        bodyDefault: !capture && !parsed && args.body === undefined,
        fieldsDefault: !capture && !parsed && args.fields === undefined,
        folderDefault: args.folder_path === undefined && args.kind === undefined && !capture && !parsed },
        beforeTemplateRead: context.authorizeTemplate } : {}),
      ...(!args.template_id && args.kind === undefined && !capture && !parsed ? { folderDefaultCreation: { titleDefault: args.title === undefined, bodyDefault: args.body === undefined, fieldsDefault: args.fields === undefined }, beforeTemplateRead: context.authorizeTemplate } : {}),
      beforeCommit: (path) => context.authorize(itemId, path, true) });
  }
  only(args, name === "append_to_item"
    ? ["id", "markdown", "markdown_fragment", "if_match_hash", "idempotency_key"]
    : ["id", "title", "body", "excerpt", "tags", "fields", "section", "expected_section_body", "if_match_hash", "idempotency_key"]);
  if (typeof args.id !== "string") throw new Error("Item not found.");
  const itemId = args.id;
  // authorize before opening content, then again under the commit lock.
  await context.authorize(itemId, "", false);
  if (typeof args.if_match_hash !== "string") throw new Error("Read the item before editing.");
    const mutation: DocumentMutation = {};
    if (args.fields !== undefined) {
      if (!args.fields || typeof args.fields !== "object" || Array.isArray(args.fields)) throw new Error("Fields must be a map.");
      mutation.fields = args.fields as NonNullable<DocumentMutation["fields"]>;
    }
    if (name === "append_to_item") {
      const text = args.markdown ?? args.markdown_fragment;
      if (typeof text !== "string" || !text) throw new Error("Append text is required.");
      mutation.appendBody = text;
    } else {
      if (typeof args.title === "string") mutation.title = args.title;
      if (args.excerpt === null || typeof args.excerpt === "string") mutation.subtitle = args.excerpt;
      if (Array.isArray(args.tags)) mutation.tags = args.tags as string[];
      if (typeof args.section === "string") {
        if (typeof args.expected_section_body !== "string" || typeof args.body !== "string") throw new Error("Section edits require the original and replacement body.");
        mutation.bodySection = { heading: args.section, expectedBody: args.expected_section_body, replacementBody: args.body };
      } else if (typeof args.body === "string") mutation.body = args.body;
    }
    return mutateVaultDocument({ ...location, itemId, operationId, expectedRevision: args.if_match_hash,
      mutation, actorUserId: context.actorUserId, actorType: context.actorType ?? "external_agent",
      beforeCommit: (path) => context.authorize(itemId, path, false) });
}
