import { validatePortableFolderPath } from "@/lib/vault/portable-folder-path";
import { publicFeedURL } from "@/lib/vault/rss";
import { readVaultFeed } from "@/lib/vault/rss-feed.server";
import { mutateVaultTool, type VaultMutationContext } from "./vault-mutations";

/** Reuse the ordinary marked bookmark and durable write used by the file UI. */
export async function addVaultFeed(args: Record<string, unknown>, context: VaultMutationContext) {
  if (Object.keys(args).some(key => !["url", "parent_path", "name", "idempotency_key"].includes(key))) throw new Error("Unsupported file feed fields.");
  const url = publicFeedURL(String(args.url ?? ""));
  const folder = validatePortableFolderPath(String(args.parent_path ?? ""));
  if (!folder || folder.split("/").some(part => !part || part.startsWith(".")) || /[\\\x00-\x1f]/.test(folder)) throw new Error("Choose a valid feed folder.");
  if (typeof args.idempotency_key !== "string" || !args.idempotency_key.trim()) throw new Error("A stable idempotency_key is required.");
  if (args.name !== undefined && (typeof args.name !== "string" || !args.name.trim() || args.name.length > 120)) throw new Error("Choose a feed name up to 120 characters.");
  const title = typeof args.name === "string" ? args.name.trim() : new URL(url).hostname;
  // Dynamic publisher metadata cannot change the reviewed retry fingerprint.
  const creation = { title, body: "", kind: "bookmark", folder_path: folder,
    fields: { texttextFeedSubscription: "v1", feedUrl: url },
    idempotency_key: `feed:${args.idempotency_key}` };
  await context.authorize("", `${folder}/Feed subscription.textpack`, true);
  try {
    const receipt = await mutateVaultTool("create_item", creation, { ...context, receiptOnly: true });
    return context.receiptOnly ? receipt : await mutateVaultTool("create_item", creation, context);
  } catch (error) {
    if (context.receiptOnly || !(error instanceof Error) || error.message !== "No completed receipt exists for this approved operation.") throw error;
  }
  // Existing SSRF-safe UI service; never called during proposal staging.
  await readVaultFeed(url);
  await context.authorize("", `${folder}/Feed subscription.textpack`, true);
  return mutateVaultTool("create_item", creation, context);
}
