import { validateDocumentSnapshot } from "@/lib/documents/model";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";
import { VaultError, type VaultFile, type VaultTransport, type VaultListing } from "./bridge";
import { readDocument, readTemplate, writePayload } from "./model";

/** Folder tools use the same transport and permission checks as ordinary creation. */
export async function executeWindowsFolderAgentTool(request: VaultTransport, folder: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const valid = (path: string) => !path || !path.split("/").some(part => !part || part.startsWith(".") || /[\\:\x00-\x1f]/.test(part));
  const inside = (path: string) => valid(path) && (!folder || path.startsWith(folder + "/"));
  if (!valid(folder)) throw new Error("Invalid folder scope.");
  if (signal?.aborted) throw new DOMException("Task stopped", "AbortError");
  const listing = await request("list", {}, signal) as VaultListing;
  if (folder && !listing.folders?.includes(folder)) throw new Error("Choose an existing folder.");
  if (tool === "list_files") return JSON.stringify({ paths: listing.items.filter(item => inside(item.path)).map(item => item.path) });
  if (tool === "create_file") {
    const destination = args.folder === undefined ? folder : args.folder;
    if (typeof destination !== "string" || !valid(destination) || (destination !== folder && !inside(destination))) throw new Error("Create only inside the selected folder.");
    if (destination && !listing.folders?.includes(destination)) throw new Error("Choose an existing folder.");
    if (typeof args.title !== "string" || !args.title.trim() || args.title.length > 240 || typeof args.body !== "string" || args.body.length > 2_000_000) throw new Error("Provide a title and body.");
    if (args.kind !== undefined && !["note", "article", "bookmark", "gallery", "talk"].includes(String(args.kind))) throw new Error("Choose a supported item type.");
    if (signal?.aborted) throw new DOMException("Task stopped", "AbortError");
    const saved = await request("create", { title: args.title, body: args.body, folder: destination, ...(args.kind ? { kind: args.kind } : {}) }, signal) as VaultFile;
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
