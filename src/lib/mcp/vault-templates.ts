import { isTemplateRetirementPath, parseTemplateRetirement } from "@/lib/presentation/template-retirement";
import { openPack } from "@/local-vault/pack";
import { readDocument } from "@/local-vault/model";
import { createHash } from "node:crypto";
import { listVaultTextpacks, readVaultTemplate, mutateVaultDocument, createVaultTemplate, retireVaultTemplate, readVaultTextpack, setVaultFolderTemplate } from "@/lib/store";
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from "@/lib/presentation/templates";
import { validatedLookSource } from "@/lib/presentation/template-library";
import type { VaultTemplateCreation } from "@/lib/presentation/vault-template-authoring";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
export type VaultTemplateContext = {
  receiptOnly?: boolean;
  root: string; workspaceId: string; actorUserId: string; actorType: "human" | "external_agent";
  authorizeFolder?: (folder: string) => Promise<void>;
  authorizeCreation?: (path: string) => Promise<void>;
  authorize: (itemId: string, path: string, write: boolean) => Promise<void>;
};
export async function executeVaultTemplateTool(name: string, args: Record<string, unknown>, context: VaultTemplateContext) {
  if (args.template_id !== undefined && (typeof args.template_id !== "string" || !args.template_id.length)) throw new Error("Invalid template identifier");
  if (args.template_version !== undefined && (typeof args.template_version !== "number" || !Number.isSafeInteger(args.template_version) || args.template_version < 1)) throw new Error("Invalid template version");
  const location = { receiptOnly: context.receiptOnly, root: context.root, workspaceId: context.workspaceId };
  if (name === "set_folder_template") {
    if (Object.keys(args).some(key => !["folder_path", "template_id", "template_version", "source_item_id", "source_hash", "if_match_hash", "idempotency_key"].includes(key)) || !context.authorizeFolder || typeof args.folder_path !== "string" || typeof args.template_id !== "string" || typeof args.template_version !== "number" || typeof args.idempotency_key !== "string" || !args.idempotency_key.trim() || !(args.if_match_hash === null || typeof args.if_match_hash === "string" && /^[a-f0-9]{64}$/.test(args.if_match_hash))) throw new Error("Choose a folder, exact template version, current folder view hash (or null) and stable idempotency key");
    let source: { itemId: string; revision: string } | undefined;
    if (args.source_item_id !== undefined || args.source_hash !== undefined) {
      if (typeof args.source_item_id !== "string" || typeof args.source_hash !== "string" || !/^[a-f0-9]{64}$/.test(args.source_hash)) throw new Error("Provide the pinned custom template source");
      source = { itemId: args.source_item_id, revision: args.source_hash };
    }
    const operationId = createHash("sha256").update(JSON.stringify([context.actorUserId, name, args.idempotency_key])).digest("hex");
    const result = await setVaultFolderTemplate({ ...location, folder: args.folder_path, operationId, expectedRevision: args.if_match_hash, templateId: args.template_id, templateVersion: args.template_version, source, actorUserId: context.actorUserId, actorType: context.actorType, beforeCommit: context.authorizeFolder, beforeTemplateRead: (id, path) => context.authorize(id, path, false) });
    if (result.status === "conflict") throw new Error("The folder view changed. Read it again.");
    return result;
  }
  if (name === "retire_document_template") {
    if (Object.keys(args).some(key => !["template_id", "source_item_id", "source_hash", "idempotency_key"].includes(key)) || typeof args.template_id !== "string" || typeof args.source_item_id !== "string" || typeof args.source_hash !== "string" || typeof args.idempotency_key !== "string" || !args.idempotency_key.trim() || args.idempotency_key.length > 200 || !context.authorizeCreation) throw new Error("Read the custom template and provide its source hash and a stable idempotency key");
    const operationId = createHash("sha256").update(JSON.stringify([context.actorUserId, name, args.idempotency_key])).digest("hex");
    return retireVaultTemplate({ ...location, templateId: args.template_id, sourceItemId: args.source_item_id, sourceHash: args.source_hash, operationId,
      actorUserId: context.actorUserId, actorType: context.actorType, beforeCommit: context.authorizeCreation,
      beforeSourceRead: (id, path) => context.authorize(id, path, true) });
  }
  if (name === "remix_item_type") {
    if (Object.keys(args).some(key => !["template_id", "template_version", "name", "source_item_id", "source_hash", "idempotency_key"].includes(key)) || !context.authorizeCreation || typeof args.template_id !== "string" || typeof args.template_version !== "number" || typeof args.name !== "string" || !args.name.trim() || args.name.length > 160 || typeof args.idempotency_key !== "string" || !args.idempotency_key.trim()) throw new Error("Choose an exact template version, new name and stable idempotency key");
    const operationId = createHash("sha256").update(JSON.stringify([context.actorUserId, name, args.idempotency_key])).digest("hex");
    const itemId = `${operationId.slice(0,8)}-${operationId.slice(8,12)}-4${operationId.slice(13,16)}-8${operationId.slice(17,20)}-${operationId.slice(20,32)}`;
    let creation: VaultTemplateCreation;
    if (args.source_item_id !== undefined || args.source_hash !== undefined) {
      if (typeof args.source_item_id !== "string" || typeof args.source_hash !== "string" || !/^[a-f0-9]{64}$/.test(args.source_hash)) throw new Error("Custom templates require source_item_id and source_hash from the template list");
      creation = { sourceItemId: args.source_item_id, sourceHash: args.source_hash, remix: { templateId: args.template_id, templateVersion: args.template_version, name: args.name } };
    } else {
      if ((!BUILTIN_TEMPLATES.some(template => template.id === args.template_id) || !getBuiltinTemplate(args.template_id as string, args.template_version as number))) throw new Error("Choose an exact built-in version or provide a pinned custom template source");
      creation = { builtinTemplateId: args.template_id, builtinTemplateVersion: args.template_version, name: args.name };
    }
    const receipt = await createVaultTemplate({ ...location, itemId, operationId, creation, actorUserId: context.actorUserId, actorType: context.actorType,
      beforeCommit: context.authorizeCreation, beforeSourceRead: (id, path) => context.authorize(id, path, false) });
    if (receipt.status === "conflict") throw new Error("Template destination is occupied");
    return { ...receipt, template_id: `local.${itemId}`, template_version: 1, source_item_id: itemId, source_hash: receipt.revision };
  }
  if (name === "update_item_type") {
    if (Object.keys(args).some(key => !["template_id", "base_version", "source_item_id", "source_hash", "blueprint", "definition", "idempotency_key", "apply", "apply_to_existing"].includes(key)) || args.apply === true || args.apply_to_existing === true) throw new Error("Save a new template version separately from applying it to existing items.");
    if (!context.authorizeCreation || typeof args.template_id !== "string" || typeof args.base_version !== "number" || !Number.isSafeInteger(args.base_version) || args.base_version < 1 || args.base_version >= Number.MAX_SAFE_INTEGER || typeof args.source_item_id !== "string" || typeof args.source_hash !== "string" || typeof args.idempotency_key !== "string" || !args.idempotency_key.trim()) throw new Error("Read the template and provide its source hash, base version and stable idempotency key");
    const version = args.base_version + 1;
    const operationId = createHash("sha256").update(JSON.stringify([context.actorUserId, name, args.idempotency_key])).digest("hex");
    const seed = createHash("sha256").update(JSON.stringify([context.workspaceId, args.template_id, version])).digest("hex");
    const itemId = `${seed.slice(0,8)}-${seed.slice(8,12)}-4${seed.slice(13,16)}-8${seed.slice(17,20)}-${seed.slice(20,32)}`;
    const creation: VaultTemplateCreation = { sourceItemId: args.source_item_id, sourceHash: args.source_hash, update: { templateId: args.template_id, baseVersion: args.base_version, ...(args.blueprint !== undefined ? { blueprint: args.blueprint } : {}), ...(args.definition !== undefined ? { definition: args.definition } : {}) } };
    const receipt = await createVaultTemplate({ ...location, itemId, operationId, creation, actorUserId: context.actorUserId, actorType: context.actorType,
      beforeCommit: context.authorizeCreation, beforeSourceRead: (id, path) => context.authorize(id, path, true) });
    if (receipt.status === "conflict") throw new Error("A newer template version already exists. Refresh the template list.");
    return { ...receipt, template_id: args.template_id, template_version: version, source_item_id: itemId, source_hash: receipt.revision };
  }
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
    const retired = new Set<string>();
    const records = inventory.items.filter(item => isTemplateRetirementPath(item.relativePath));
    if (records.length > 1000) throw new Error("Template retirement inventory exceeds limits");
    for (const item of records) {
      await context.authorize(item.itemId, item.relativePath, false);
      const pack = await readVaultTextpack({ ...location, itemId: item.itemId });
      if (!pack) throw new Error("Template retirement record changed. List templates again.");
      const document = readDocument(openPack(pack.bytes, pack.relativePath, pack.revision, item.itemId).file);
      if (document.content.fields.texttextRecordType !== "template-retirement") throw new Error("Invalid template retirement record");
      retired.add(parseTemplateRetirement(document.content.body).templateId);
    }
    const sources = inventory.items.filter(item => /^Templates\//i.test(item.relativePath) && !isTemplateRetirementPath(item.relativePath));
    const custom: { definition: ReturnType<typeof validateTemplateDefinition>; scope: string; authoring_source?: ReturnType<typeof validatedLookSource>; source_item_id: string; source_hash: string; path: string }[] = [];
    let skipped = 0, accessible = 0, truncated = false;
    for (const item of sources) {
      try { await context.authorize(item.itemId, item.relativePath, false); } catch { continue; }
      if (++accessible > 100) { truncated = true; break; }
      try {
        const metadata = await readVaultTemplate({ ...location, itemId: item.itemId });
        if (!metadata?.templateJSON || metadata.hash !== item.revision || metadata.path !== item.relativePath) { skipped++; continue; }
        const definition = validateTemplateDefinition(JSON.parse(metadata.templateJSON));
        await context.authorize(item.itemId, metadata.path, false);
        if (!retired.has(definition.id) && (!args.template_id || definition.id === args.template_id)) custom.push({ definition, ...(metadata.templateAuthoringSourceJSON ? { authoring_source: validatedLookSource(definition, JSON.parse(metadata.templateAuthoringSourceJSON)) } : {}), scope: "workspace", source_item_id: item.itemId, source_hash: metadata.hash, path: metadata.path });
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
    const definition = version === undefined ? BUILTIN_TEMPLATES.find(template => template.id === templateId) : BUILTIN_TEMPLATES.some(template => template.id === templateId) ? getBuiltinTemplate(templateId, version) : null;
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
