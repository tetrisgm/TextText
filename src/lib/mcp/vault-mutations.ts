import { createHash, randomUUID } from "node:crypto";
import { mutateVaultDocument, writeVaultTextpack } from "@/lib/store";
import { type DocumentMutation } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { buildTextpack } from "@/lib/github/textpack";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";

export type VaultMutationContext = {
  root: string; workspaceId: string; actorUserId: string;
  authorize: (itemId: string, path: string, creating: boolean) => Promise<void>;
};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function only(args: Record<string, unknown>, keys: readonly string[]) {
  const unsupported = Object.keys(args).filter((key) => !keys.includes(key));
  if (unsupported.length) throw new Error(`Unsupported file command fields: ${unsupported.join(", ")}`);
}
export async function mutateVaultTool(name: string, args: Record<string, unknown>, context: VaultMutationContext) {
  const location = { root: context.root, workspaceId: context.workspaceId };
  const operationId = typeof args.idempotency_key === "string"
    ? digest(`${context.actorUserId}:${name}:${args.idempotency_key}`) : randomUUID();
  if (name === "create_item") {
    only(args, ["title", "body", "excerpt", "kind", "fields", "folder_path", "idempotency_key"]);
    const kind = typeof args.kind === "string" ? args.kind : "note";
    if (!["note", "article", "bookmark", "gallery", "talk"].includes(kind)) throw new Error("Unsupported item kind.");
    const template = requireBuiltinTemplate(`texttext.${kind}`);
    const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
    document.content.title = typeof args.title === "string" ? args.title : "Untitled";
    document.content.body = typeof args.body === "string" ? args.body : "";
    if (typeof args.excerpt === "string") document.content.subtitle = args.excerpt;
    if (args.fields && typeof args.fields === "object") document.content.fields = args.fields as typeof document.content.fields;
    const seed = digest(operationId);
    const itemId = `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-8${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
    const folder = typeof args.folder_path === "string" ? args.folder_path : ({ note: "Notes", article: "Blog", bookmark: "Bookmarks", gallery: "Gallery", talk: "Presentations" }[kind]);
    if (!folder || folder.split("/").some((part) => !part || part === "." || part === "..") || /[\\\x00]/.test(folder)) throw new Error("Invalid folder.");
    const title = document.content.title.replace(/[\/\\:*?"<>|\x00-\x1f]/g, " ").trim().slice(0, 80) || "Untitled";
    const relativePath = `${folder}/${title}-${itemId.slice(0, 8)}.textpack`;
    await context.authorize(itemId, relativePath, true);
    const markdown = `---\ntextTextId: ${itemId}\ntitle: ${JSON.stringify(document.content.title)}\n---\n\n${document.content.body}`;
    return writeVaultTextpack({ ...location, itemId, operationId, relativePath, baseRevision: null,
      bytes: buildTextpack("Document", { document, markdown, template }), actorUserId: context.actorUserId, actorType: "external_agent",
      beforeCommit: (path) => context.authorize(itemId, path, true) });
  }
  only(args, name === "append_to_item"
    ? ["id", "markdown", "markdown_fragment", "if_match_hash", "idempotency_key"]
    : ["id", "title", "body", "excerpt", "tags", "section", "expected_section_body", "if_match_hash", "idempotency_key"]);
  if (typeof args.id !== "string") throw new Error("Item not found.");
  const itemId = args.id;
  // authorize before opening content, then again under the commit lock.
  await context.authorize(itemId, "", false);
  if (typeof args.if_match_hash !== "string") throw new Error("Read the item before editing.");
    const mutation: DocumentMutation = {};
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
      mutation, actorUserId: context.actorUserId, actorType: "external_agent",
      beforeCommit: (path) => context.authorize(itemId, path, false) });
}
