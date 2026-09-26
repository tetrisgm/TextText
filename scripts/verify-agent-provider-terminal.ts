// Bounded real-provider integration proof for the existing local test document.
// No browser, developer AI override, mocks, external MCP, or direct content writes.
// Run against one already-running local Next dev server:
// node --env-file=.env.local --import tsx scripts/verify-agent-provider-terminal.ts
// Provider credentials remain in Keychain, memory, and the existing encrypted DB.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentRenderer } from "../src/components/document/DocumentRenderer";
import { db, closeDatabaseConnections } from "../src/lib/db/client";
import { workspaceAiConfigs } from "../src/lib/db/schema";
import { requireDocumentSnapshot } from "../src/lib/documents/model";
import { stableJson } from "../src/lib/documents/sync";
import { getBlogEditRecord, getPostById, getDocumentTemplate, getDocumentTemplateAuthoringSource } from "../src/lib/store";
import { itemTypeBlueprintSchema, type ItemTypeBlueprint } from "../src/lib/presentation/item-type-blueprint";
import type { TemplateDefinition } from "../src/lib/presentation/schema";
import { TextTextClient } from "./texttext-live-client";

const origin = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const handle = "visual-demo";
const postId = "44d13a24-03d4-4fbe-8b32-cd2df1cf2acd";
const pagePath = "/@visual-demo/codex-capture-verification-2026-09-25";
const provider = "anthropic";
const model = "claude-sonnet-5";
const receiptPath = "/tmp/texttext-live-agent-provider-receipt.json";
const prompts = [
  "Make this a research reader. Keep the article readable and put my commentary beside it. Preserve the Markdown and existing fields.",
  "Make the commentary narrower and keep the source reference visible.",
];
const checks: Array<{ claim: string; passed: boolean; detail?: unknown }> = [];
const receipt: Record<string, unknown> = {
  runAt: new Date().toISOString(), origin, handle, postId, provider, model,
  provenance: "Terminal HTTP integration using dev-login, live provider, production route and ordinary server actions. Not native UI proof.",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  uncommittedSource: true, developerAiOverride: false, checks,
};
class BoundedLocalClient extends TextTextClient {
  override http(path: string, init: RequestInit = {}) {
    return super.http(path, { ...init, signal: init.signal ?? AbortSignal.timeout(65_000) });
  }
}
const client = new BoundedLocalClient(origin);
function persist() { writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 }); }
function check(claim: string, passed: boolean, detail?: unknown) {
  checks.push({ claim, passed, ...(detail !== undefined ? { detail } : {}) });
  persist();
  console.log(`${passed ? "ok" : "FAIL"} ${claim}`);
  if (!passed) throw new Error(claim);
}
function digest(value: unknown) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function localOnly() {
  const local = ["localhost", "127.0.0.1", "::1"];
  if (!local.includes(new URL(origin).hostname) || !local.includes(new URL(process.env.DATABASE_URL ?? "").hostname)) throw new Error("Requires local server and database");
  if (process.env.TEXTTEXT_DEV_AI_KEY || process.env.TEXTTEXT_DEV_AI_PROVIDER || process.env.TEXTTEXT_AI_BASE_URL) throw new Error("Remove all developer AI overrides before running");
  if (!db) throw new Error("Local database unavailable");
}
async function action<T>(name: string, args: unknown[], targetClient = client): Promise<T> {
  const manifest = JSON.parse(readFileSync(".next/dev/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string }> };
  const id = Object.entries(manifest.node).find(([, entry]) => entry.exportedName === name)?.[0];
  if (!id) throw new Error(`Action not compiled: ${name}`);
  const response = await targetClient.http(pagePath, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Origin: origin, "Next-Action": id }, body: JSON.stringify(args), signal: AbortSignal.timeout(65_000) });
  const payload = await response.text();
  if (!response.ok) throw new Error(`Action ${name} HTTP ${response.status}`);
  // The actions under test return ordinary JSON data. Ignore framework flight
  // metadata and never print the raw response (configuration input is secret).
  for (const line of payload.split("\n")) {
    const match = /^[0-9a-f]+:(\{.*\})$/.exec(line);
    if (!match) continue;
    let value: Record<string, unknown>;
    try { value = JSON.parse(match[1]); } catch { continue; }
    if ("ok" in value || "allowed" in value) return value as T;
  }
  throw new Error(`Action ${name} did not return a readable receipt`);
}
type Settings = { allowed: boolean; configured: boolean; provider: string | null; model: string | null; connectionState: string; failure?: { code: string; requestId: string } };
type Generated = { blueprint: ItemTypeBlueprint; template: TemplateDefinition; requestId: string; provider: string; model: string; failure?: { code: string; requestId: string } };
async function generate(prompt: string, current: ItemTypeBlueprint | null, revision: number): Promise<Generated> {
  const requestId = randomUUID();
  const response = await client.http("/api/ai/item-type", { method: "POST", headers: { "Content-Type": "application/json", "x-texttext-request-id": requestId }, body: JSON.stringify({ prompt, current, workspaceHandle: handle, targetPostId: postId, expectedRevision: revision, model }), signal: AbortSignal.timeout(65_000) });
  const result = await response.json() as Generated;
  const diagnostic = { status: response.status, requestId: result.requestId ?? result.failure?.requestId ?? requestId, provider: result.provider ?? provider, model: result.model ?? model, ...(result.failure ? { failureCode: result.failure.code } : {}) };
  const requests = (receipt.requests ??= []) as unknown[];
  requests.push(diagnostic);
  check("Real provider request completed", response.ok && result.provider === provider && result.model === model, diagnostic);
  result.blueprint = itemTypeBlueprintSchema.parse(result.blueprint);
  return result;
}
async function run() {
  localOnly();
  const post = await getPostById(handle, postId);
  const owner = await getBlogEditRecord(handle);
  if (!post?.revision || !owner || !db) throw new Error("Existing authorized local fixture is missing");
  const original = requireDocumentSnapshot(post.document);
  const stableMetadata = (value: typeof post) => ({ type: value.type, visibility: value.visibility, status: value.status, slug: value.slug, folderId: value.folderId, tags: value.tags, starred: value.starred, pinned: value.pinned, representation: value.representation, createdAt: value.createdAt, date: value.date });
  receipt.original = { revision: post.revision, template: original.presentation.template, contentHash: digest(original.content), metadataHash: digest(stableMetadata(post)), fieldNames: Object.keys(original.content.fields) };
  const previous = await db.select().from(workspaceAiConfigs).where(eq(workspaceAiConfigs.blogId, owner.id));
  const backupPath = `/tmp/texttext-local-ai-config-backup-${Date.now()}.json`;
  writeFileSync(backupPath, JSON.stringify(previous), { mode: 0o600 });
  receipt.encryptedConfigBackup = backupPath;
  await client.signIn("visual-demo@texttext.local", "Mira Chen");
  const initialPage = await client.http(pagePath);
  await initialPage.arrayBuffer();
  check("Existing document opens through authenticated HTTP", initialPage.ok);
  const before = await action<Settings>("getWorkspaceAiSettingsAction", [handle]);
  receipt.connectionBefore = before;
  check("Existing selected provider/model is unchanged", before.provider === provider && before.model === model);
  if (process.env.TEXTTEXT_LIVE_CHECK_ONLY === "1") return;
  let key = execFileSync("/usr/bin/security", ["find-generic-password", "-s", "texttext-dev-anthropic", "-a", "api-key", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 }).trim();
  const configured = await action<Settings>("saveWorkspaceAiSettingsAction", [handle, provider, model, key]);
  key = "";
  receipt.connectionAfterSetup = configured;
  check("Setup action proves real generation and saves protected config", configured.connectionState === "ready" && !configured.failure, configured.failure && { code: configured.failure.code, requestId: configured.failure.requestId });
  const authoring = await getDocumentTemplateAuthoringSource(owner.id, original.presentation.template.id);
  const first = await generate(prompts[0], authoring?.source?.blueprint ?? null, post.revision);
  check("First real preview uses reader layout", first.blueprint.item.layout === "reader" && first.blueprint.item.showBody);
  const firstHtml = renderToStaticMarkup(createElement(DocumentRenderer, { document: original, template: first.template, preview: true }));
  check("First preview renders actual selected body and commentary", firstHtml.includes("reader-columns") && firstHtml.includes("My commentary survives a template switch.") && firstHtml.includes("remains a note."));
  const refined = await generate(prompts[1], first.blueprint, post.revision);
  check("Refinement requests the supported narrower commentary", refined.blueprint.item.commentaryWidth === "narrow");
  const refinedHtml = renderToStaticMarkup(createElement(DocumentRenderer, { document: original, template: refined.template, preview: true }));
  check("Refined actual renderer retains source and narrower notes", refinedHtml.includes('data-tt-node="reader-notes-narrow"') && refinedHtml.includes('href="https://example.com/"') && refinedHtml.includes("My commentary survives a template switch."));
  receipt.generated = { firstBlueprintHash: digest(first.blueprint), refinedBlueprintHash: digest(refined.blueprint), refinedLayout: refined.blueprint.item.layout, commentaryWidth: refined.blueprint.item.commentaryWidth, fieldNames: refined.blueprint.fields.map(field => field.id) };
  const saveRequestId = randomUUID();
  type Created = { ok: boolean; recovered?: boolean; itemType?: { id: string; version: number } };
  const saved = await action<Created>("createItemTypeAction", [handle, refined.blueprint, null, false, saveRequestId]);
  check("Ordinary save action creates agent-authored validated template", Boolean(saved.ok && saved.itemType));
  const target = saved.itemType!;
  const applyArgs = [handle, postId, target.id, target.version, post.revision];
  const applied = await action<{ ok: boolean; revision?: number }>("applyItemTemplateAction", applyArgs);
  check("Ordinary apply action checks revision and returns authoritative receipt", Boolean(applied.ok && applied.revision && applied.revision > post.revision));
  const after = await getPostById(handle, postId);
  if (!after) throw new Error("Saved document unavailable");
  const savedDocument = requireDocumentSnapshot(after.document);
  check("Authoritative saved document pins real generated template", savedDocument.presentation.template.id === target.id && savedDocument.presentation.template.version === target.version);
  check("Markdown and every original field preserved exactly", digest(original.content) === digest(savedDocument.content));
  check("Original metadata and audience preserved exactly", digest(stableMetadata(post)) === digest(stableMetadata(after)), Object.keys(stableMetadata(post)));
  const storedTemplate = await getDocumentTemplate(owner.id, target);
  check("Authoritative stored template matches generated definition", Boolean(storedTemplate && digest({ ...refined.template, ...target }) === digest(storedTemplate)));
  const retriedSave = await action<Created>("createItemTypeAction", [handle, refined.blueprint, null, false, saveRequestId]);
  check("Lost-save reconciliation reuses immutable saved template", Boolean(retriedSave.ok && retriedSave.recovered && retriedSave.itemType?.id === target.id));
  const retriedApply = await action<{ ok: boolean; revision?: number }>("applyItemTemplateAction", applyArgs);
  check("Lost-apply reconciliation performs no second document write", retriedApply.ok && retriedApply.revision === after.revision);
  const staleApply = await action<{ ok: boolean; code?: string }>("applyItemTemplateAction", [handle, postId, original.presentation.template.id, original.presentation.template.version, post.revision]);
  check("A concurrent stale revision cannot overwrite the saved look", !staleApply.ok && staleApply.code === "conflict");
  const reopened = new BoundedLocalClient(origin);
  await reopened.signIn("visual-demo@texttext.local", "Mira Chen");
  const reopenedPage = await reopened.http(pagePath);
  const reopenedHtml = await reopenedPage.text();
  check("Reopened authenticated document renders saved generated look", reopenedPage.ok && reopenedHtml.includes("reader-notes-narrow") && reopenedHtml.includes("My commentary survives a template switch."));
  const continued = await action<Settings>("getWorkspaceAiSettingsAction", [handle], reopened);
  check("Fresh session retains verified connection without another setup", continued.connectionState === "ready" && continued.provider === provider && continued.model === model);
  receipt.saved = { template: target, revision: after.revision, contentHash: digest(savedDocument.content), metadataHash: digest(stableMetadata(after)), saveRequestId };
  receipt.completedAt = new Date().toISOString();
}
run().catch((error: unknown) => {
  receipt.failed = error instanceof Error ? { name: error.name, stage: checks.at(-1)?.claim ?? "initialization" } : { stage: "unknown" };
  // Do not output raw provider errors, auth response bodies, or DB parameters.
  console.error("Integration stopped; inspect the redacted receipt.");
  process.exitCode = 1;
}).finally(async () => { persist(); await closeDatabaseConnections(); });
