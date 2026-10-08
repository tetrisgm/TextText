import { createHash } from "node:crypto";
import { listVaultTextpacks, readVaultTemplate, mutateVaultDocument, createVaultTemplate } from "@/lib/store";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
export type VaultTemplateContext = {
  receiptOnly?: boolean;
  root: string; workspaceId: string; actorUserId: string; actorType: "human" | "external_agent";
  authorizeCreation?: (path: string) => Promise<void>;
  authorize: (itemId: string, path: string, write: boolean) => Promise<void>;
};
export async function executeVaultTemplateTool(name: string, args: Record<string, unknown>, context: VaultTemplateContext) {
  if (args.template_id !== undefined && (typeof args.template_id !== "string" || !args.template_id.length)) throw new Error("Invalid template identifier");
  if (args.template_version !== undefined && (typeof args.template_version !== "number" || !Number.isSafeInteger(args.template_version) || args.template_version < 1)) throw new Error("Invalid template version");
  const location = { receiptOnly: context.receiptOnly, root: context.root, workspaceId: context.workspaceId };
  if (name === "create_item_type" || name === "save_item_as_look") {
    const allowed = name === "create_item_type" ? ["blueprint", "idempotency_key", "apply_to_existing"] : ["id", "name", "if_match_hash", "idempotency_key"];
    if (Object.keys(args).some(key => !allowed.includes(key)) || args.apply_to_existing === true) throw new Error("This command creates a new template only; it does not change folders or existing items.");
    if (!context.authorizeCreation || typeof args.idempotency_key !== "string" || !args.idempotency_key.trim()) throw new Error("Template creation requires destination access and a stable idempotency key");
    const operationId = createHash("sha256").update(JSON.stringify([context.actorUserId, name, args.idempotency_key])).digest("hex");
    const itemId = `${operationId.slice(0,8)}-${operationId.slice(8,12)}-4${operationId.slice(13,16)}-8${operationId.slice(17,20)}-${operationId.slice(20,32)}`;
    if (name === "save_item_as_look" && (typeof args.id !== "string" || typeof args.if_match_hash !== "string" || typeof args.name !== "string")) throw new Error("Read the item and provide its hash and a look name");
    const creation = name === "create_item_type" ? { blueprint: args.blueprint } : { sourceItemId: args.id as string, sourceHash: args.if_match_hash as string, name: args.name as string };
    const receipt = await createVaultTemplate({ ...location, itemId, operationId, creation,
      actorUserId: context.actorUserId, actorType: context.actorType,
      beforeCommit: context.authorizeCreation, beforeSourceRead: (id, path) => context.authorize(id, path, false) });
    if (receipt.status === "conflict") throw new Error("Template destination is occupied");
    return { ...receipt, template_id: `local.${itemId}`, template_version: 1, source_item_id: itemId, source_hash: receipt.revision };
  }
  if (name === "list_document_templates") {
    if (Object.keys(args).some(key => key !== "template_id")) throw new Error("Unsupported template listing fields");
    const builtins = BUILTIN_TEMPLATES.filter(template => !args.template_id || template.id === args.template_id).map(definition => ({ definition, scope: "texttext" }));
    const inventory = await listVaultTextpacks(location);
    const sources = inventory.items.filter(item => /^Templates\//i.test(item.relativePath));
    const custom: { definition: ReturnType<typeof validateTemplateDefinition>; scope: string; source_item_id: string; source_hash: string; path: string }[] = [];
    let skipped = 0, accessible = 0, truncated = false;
    for (const item of sources) {
      try { await context.authorize(item.itemId, item.relativePath, false); } catch { continue; }
      if (++accessible > 100) { truncated = true; break; }
      try {
        const metadata = await readVaultTemplate({ ...location, itemId: item.itemId });
        if (!metadata?.templateJSON || metadata.hash !== item.revision || metadata.path !== item.relativePath) { skipped++; continue; }
        const definition = validateTemplateDefinition(JSON.parse(metadata.templateJSON));
        await context.authorize(item.itemId, metadata.path, false);
        if (!args.template_id || definition.id === args.template_id) custom.push({ definition, scope: "workspace", source_item_id: item.itemId, source_hash: metadata.hash, path: metadata.path });
      } catch { skipped++; }
    }
    return { templates: [...builtins, ...custom], truncated, skipped };
  }
  if (name !== "set_item_template" || Object.keys(args).some(key => !["id", "template_id", "template_version", "source_item_id", "source_hash", "if_match_hash", "idempotency_key"].includes(key))) throw new Error("Unsupported template command");
  if (typeof args.id !== "string" || typeof args.template_id !== "string" || typeof args.if_match_hash !== "string" || typeof args.idempotency_key !== "string" || !args.idempotency_key.trim()) throw new Error("Read the item and provide its hash and a stable idempotency key");
  const templateId = args.template_id;
  const version = typeof args.template_version === "number" ? args.template_version : undefined;
  let presentation: NonNullable<Parameters<typeof mutateVaultDocument>[0]["presentation"]>;
  if (args.source_item_id !== undefined || args.source_hash !== undefined) {
    if (typeof args.source_item_id !== "string" || typeof args.source_hash !== "string" || !/^[a-f0-9]{64}$/.test(args.source_hash)) throw new Error("Custom templates require source_item_id and source_hash from the template list");
    presentation = { source: { itemId: args.source_item_id, revision: args.source_hash, templateId, templateVersion: version } };
  } else {
    const definition = BUILTIN_TEMPLATES.find(template => template.id === templateId && (version === undefined || template.version === version));
    if (!definition) throw new Error("Choose a built-in or provide a pinned custom template source");
    presentation = { definition };
  }
  await context.authorize(args.id, "", true);
  const operationId = createHash("sha256").update(JSON.stringify([context.actorUserId, name, args.idempotency_key])).digest("hex");
  const receipt = await mutateVaultDocument({ ...location, itemId: args.id, operationId, expectedRevision: args.if_match_hash, mutation: {}, presentation,
    actorUserId: context.actorUserId, actorType: context.actorType,
    beforeCommit: path => context.authorize(args.id as string, path, true),
    beforeTemplateRead: (itemId, path) => context.authorize(itemId, path, false) });
  if (receipt.status === "conflict") throw new Error("The item changed. Read it again before applying a template.");
  return receipt;
}
