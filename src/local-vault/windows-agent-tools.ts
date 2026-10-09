import { loadFolderItemDefault, folderStarter } from "./folder-item-default";
import { newItemPack } from "./new-item-pack";
import { encodeBase64 } from "./image-import";
import { emptyDocumentSnapshot, validateDocumentSnapshot } from "@/lib/documents/model";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";
import { VaultError, type VaultFile, type VaultTransport, type VaultListing } from "./bridge";
import { readDocument, readTemplate, writePayload } from "./model";

/**
 * The body bytes a fresh TextPack stores in both text.md and document.json:
 * surrounding newlines trimmed, one newline closing a non-empty body. Mirrors
 * `DocumentCreation.canonicalBody` in the Mac store, so a custom snapshot an
 * agent read back from a file ("Body\n") matches the body it typed ("Body").
 */
export function canonicalBody(body: string) {
  const trimmed = body.replace(/^[\n\r\u000b\u000c\u0085\u2028\u2029]+|[\n\r\u000b\u000c\u0085\u2028\u2029]+$/g, "");
  return trimmed ? trimmed + "\n" : "";
}

/** Folder tools use the same transport and permission checks as ordinary creation. */
export async function executeWindowsFolderAgentTool(request: VaultTransport, folder: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal, operationId?: string) {
  const valid = (path: string) => !path || !path.split("/").some(part => !part || part.startsWith(".") || /[\\:\x00-\x1f]/.test(part));
  const inside = (path: string) => valid(path) && (!folder || path.startsWith(folder + "/"));
  if (!valid(folder)) throw new Error("Invalid folder scope.");
  if (signal?.aborted) throw new DOMException("Task stopped", "AbortError");
  const listing = await request("list", {}, signal) as VaultListing;
  if (folder && !listing.folders?.includes(folder)) throw new Error("Choose an existing folder.");
  if (tool === "list_files") return JSON.stringify({ paths: listing.items.filter(item => inside(item.path)).map(item => item.path) });
  if (tool === "search_files") {
    if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 500) throw new Error("Provide a search query of at most 500 characters.");
    const result = await request("search", { query: args.query, folder }, signal) as { items: { path: string; title: string; snippet: string }[]; truncated?: boolean; skippedCount?: number };
    if (!Array.isArray(result.items)) throw new Error("Search results are unavailable.");
    // Keep the boundary even if a transport returns workspace-wide results.
    const items = result.items.filter(item => typeof item.path === "string" && inside(item.path)).slice(0, 100);
    const output = JSON.stringify({ items, truncated: Boolean(result.truncated) || result.items.length > 100, skippedCount: result.skippedCount ?? 0 });
    if (new TextEncoder().encode(output).byteLength > 2_000_000) throw new Error("Search results are too large. Narrow the query.");
    return output;
  }
  if (tool === "create_file") {
    const destination = args.folder === undefined ? folder : args.folder;
    if (typeof destination !== "string" || !valid(destination) || (destination !== folder && !inside(destination))) throw new Error("Create only inside the selected folder.");
    if (destination && !listing.folders?.includes(destination)) throw new Error("Choose an existing folder.");
    if (typeof args.title !== "string" || !args.title.trim() || args.title.length > 240 || typeof args.body !== "string" || args.body.length > 2_000_000) throw new Error("Provide a title and body.");
    if (args.kind !== undefined && !["note", "article", "bookmark", "gallery", "talk"].includes(String(args.kind))) throw new Error("Choose a supported item type.");
    let creation: Record<string, unknown> = {};
    if (operationId !== undefined) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(operationId)) throw new Error("Invalid creation operation.");
      const intent = JSON.stringify({ folder, tool, arguments: Object.fromEntries(Object.keys(args).sort().map(key => [key, args[key]])) });
      const creationIntent = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(intent)))].map(value => value.toString(16).padStart(2, "0")).join("");
      creation = { creationOperationId: operationId, creationIntent, creationScope: folder };
      const resumed = await request("creationResume", creation, signal) as VaultFile | null;
      if (resumed) return JSON.stringify({ path: resumed.path, hash: resumed.hash });
    }
    if (args.documentJSON !== undefined || args.templateJSON !== undefined) {
      if (typeof args.documentJSON !== "string" || typeof args.templateJSON !== "string" || args.documentJSON.length > 2_000_000 || args.templateJSON.length > 2_000_000) throw new Error("Provide a complete matching snapshot and template.");
      const document = validateDocumentSnapshot(JSON.parse(args.documentJSON));
      const template = validateTemplateDefinition(JSON.parse(args.templateJSON));
      if (document.presentation.template.id !== template.id || document.presentation.template.version !== template.version || document.content.title !== args.title || canonicalBody(document.content.body) !== canonicalBody(args.body) || document.content.assets.length) throw new Error("Custom creation must match title/body and cannot reference assets it has not imported.");
      if (signal?.aborted) throw new DOMException("Task stopped", "AbortError");
      const saved = await request("importPack", { title: args.title, folder: destination, data: encodeBase64(newItemPack(document, { template })), ...creation }, signal) as VaultFile;
      return JSON.stringify({ path: saved.path, hash: saved.hash });
    }
    if (signal?.aborted) throw new DOMException("Task stopped", "AbortError");
    const chosen = args.kind === undefined ? await loadFolderItemDefault(destination, listing, request, signal) : null;
    if (signal?.aborted) throw new DOMException("Task stopped", "AbortError");
    let saved: VaultFile;
    if (chosen) {
      const document = emptyDocumentSnapshot({ id: chosen.template.id, version: chosen.template.version });
      document.content = { ...document.content, ...folderStarter(chosen.template, { title: args.title, body: args.body }) };
      const data = encodeBase64(newItemPack(document, { template: chosen.template, sourceJSON: chosen.authoringSource ? JSON.stringify(chosen.authoringSource) : null }));
      saved = await request("importPack", { title: args.title, folder: destination, data, ...creation }, signal) as VaultFile;
    } else saved = await request("create", { title: args.title, body: args.body, folder: destination, ...(args.kind ? { kind: args.kind } : {}), ...creation }, signal) as VaultFile;
    return JSON.stringify({ path: saved.path, hash: saved.hash });
  }
  if (!["read_file", "write_file"].includes(tool) || typeof args.path !== "string" || !inside(args.path)) throw new Error("This task can only access its selected folder.");
  return executeWindowsAgentTool(request, args.path, tool, args, signal);
}

/** Same validated primitives as the human editor. Model output never executes as markup or code. */
export async function executeWindowsAgentTool(request: VaultTransport, selectedPath: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const text = (key: string) => {
    const value = args[key];
    if (typeof value !== "string" || value.length > 2_000_000) throw new Error(`Missing or oversized ${key}.`);
    return value;
  };
  if (!["read_file", "write_file", "propose_template"].includes(tool) || text("path") !== selectedPath) throw new Error("This task can only access its selected item.");
  const file = await request("read", { path: selectedPath }, signal) as VaultFile;
  if (tool === "read_file") return JSON.stringify({ path: file.path, hash: file.hash, markdown: file.markdown,
    documentJSON: file.documentJSON ?? "", templateJSON: file.templateJSON ?? "", templateAuthoringSourceJSON: file.templateAuthoringSourceJSON ?? "" });
  if (file.hash !== text("hash")) throw new VaultError("This file changed. Read it again and preserve the intervening edits.", "conflict");
  const template = args.templateJSON === undefined ? undefined : validateTemplateDefinition(JSON.parse(text("templateJSON")));
  const sourceJSON = args.templateAuthoringSourceJSON === undefined ? undefined : text("templateAuthoringSourceJSON");
  if (sourceJSON) validatedLookSource(template ?? readTemplate(file, readDocument(file)), JSON.parse(sourceJSON));
  if (tool === "propose_template") {
    if (!template) throw new Error("A complete template is required.");
    const document = readDocument(file);
    validateDocumentSnapshot({ ...document, presentation: { ...document.presentation, template: { id: template.id, version: template.version } } });
    return JSON.stringify({ path: file.path, hash: file.hash, templateJSON: JSON.stringify(template), ...(sourceJSON ? { templateAuthoringSourceJSON: sourceJSON } : {}) });
  }
  const candidate = { ...file, markdown: text("markdown"), ...(args.documentJSON === undefined ? {} : { documentJSON: JSON.stringify(validateDocumentSnapshot(JSON.parse(text("documentJSON")))) }) };
  const document = readDocument(candidate);
  const payload = writePayload(file, document, template ? { template, sourceJSON } : undefined);
  if (signal?.aborted) throw new DOMException("Task stopped", "AbortError");
  const saved = await request("write", payload, signal) as VaultFile;
  return JSON.stringify({ path: saved.path, hash: saved.hash });
}
