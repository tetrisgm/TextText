import { fromMarkdown } from "mdast-util-from-markdown";
import type { RootContent, Root } from "mdast";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import type { DocumentMutation } from "@/lib/collab/document";
/** Remove only actual Markdown references, preserving code and unrelated prose. */
export function detachDocumentAsset(document: DocumentSnapshot, assetId: string, template?: TemplateDefinition): DocumentMutation {
  const matches = document.content.assets.filter(asset => asset.id === assetId);
  if (matches.length !== 1) throw new Error("The asset is missing or ambiguous. Read the item again.");
  const asset = matches[0];
  if (document.content.assets.some(other => other.id !== assetId && other.src === asset.src)) throw new Error("This asset source is shared by another asset.");
  const body = document.content.body; const root = fromMarkdown(body);
  const definitions = new Map<string, string>(); const edits: Array<{ start: number; end: number; text: string }> = [];
  function walk(node: Root | RootContent, visit: (node: RootContent) => boolean | void) {
    if ("children" in node) for (const child of node.children) walk(child as RootContent, visit);
    if (node.type !== "root") visit(node);
  }
  walk(root, node => { if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url); });
  walk(root, node => {
    const direct = (node.type === "image" || node.type === "link") && node.url === asset.src;
    const reference = (node.type === "imageReference" || node.type === "linkReference") && definitions.get(node.identifier) === asset.src;
    if (!direct && !reference && !(node.type === "definition" && definitions.get(node.identifier) === asset.src)) return;
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined) throw new Error("The image reference could not be located.");
    let text = "";
    if (node.type === "link" || node.type === "linkReference") {
      const first = node.children[0]?.position?.start.offset, last = node.children.at(-1)?.position?.end.offset;
      if (first !== undefined && last !== undefined) {
        text = body.slice(first, last);
        const nested = edits.filter(edit => edit.start >= first && edit.end <= last).sort((a, b) => b.start - a.start);
        for (const edit of nested) text = text.slice(0, edit.start - first) + edit.text + text.slice(edit.end - first);
        for (let i = edits.length - 1; i >= 0; i--) if (edits[i].start >= first && edits[i].end <= last) edits.splice(i, 1);
      }
    }
    edits.push({ start, end, text }); return false;
  });
  let nextBody = body;
  for (const edit of edits.sort((a, b) => b.start - a.start)) nextBody = nextBody.slice(0, edit.start) + edit.text + nextBody.slice(edit.end);
  const fields: NonNullable<DocumentMutation["fields"]> = {};
  for (const [key, value] of Object.entries(document.content.fields)) if (value === asset.src && (key === "cover" || key === "videoUrl" || template?.fields.some(field => field.id === key && (field.type === "image" || field.type === "url")))) fields[key] = null;
  if (document.content.fields.cover === asset.src) fields.coverCaption = null;
  return { assets: document.content.assets.filter(other => other.id !== assetId).map(other => other.poster === asset.src ? { ...other, poster: undefined } : other), ...(Object.keys(fields).length ? { fields } : {}), ...(nextBody !== body ? { body: nextBody } : {}) };
}
