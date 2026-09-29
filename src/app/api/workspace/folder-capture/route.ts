import { getCurrentUser } from "@/lib/session";
import { resolveFolderAccess } from "@/lib/permissions";
import { getUserIdBySub } from "@/lib/store";
import { runWorkspaceToolForSession } from "@/lib/mcp/tools";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { TENANT_HANDLE_RE } from "@/lib/tenants";

export const dynamic = "force-dynamic";

const MAX_BYTES = 1_100_000;
const headers = { "Cache-Control": "private, no-store" };

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers });
}

/** Human folder capture only. This route cannot run arbitrary assistant tools. */
export async function POST(request: Request) {
  if (request.headers.get("x-texttext-capture") !== "1" ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return error("Invalid capture request.", 403);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Invalid capture origin.", 403);
  const user = await getCurrentUser();
  if (!user) return error("Sign in to save this item.", 401);
  const input = await readBoundedJson<unknown>(request, MAX_BYTES);
  if ("error" in input || !input.value || typeof input.value !== "object" || Array.isArray(input.value)) {
    return error("Invalid capture request.", 400);
  }
  const fields = input.value as Record<string, unknown>;
  const handle = typeof fields.handle === "string" ? fields.handle.trim() : "";
  const folderPath = typeof fields.folderPath === "string" ? fields.folderPath.trim() : "";
  const capture = typeof fields.capture === "string" ? fields.capture.trim() : "";
  const key = typeof fields.idempotencyKey === "string" ? fields.idempotencyKey : "";
  if (!TENANT_HANDLE_RE.test(handle) || !folderPath || !capture || capture.length > 1_000_000 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return error("Invalid capture request.", 400);
  }
  const access = await resolveFolderAccess({ handle, folderPath, user });
  if (!access.canEditContent) return error("You cannot create items in this folder.", 403);

  // The same command validates routing, idempotency and audit for humans and
  // agents. The owner-only assistant transport remains inaccessible here.
  const userId = user.userId ?? await getUserIdBySub(user.sub);
  const result = await runWorkspaceToolForSession("create_item", {
    capture,
    folder_path: folderPath,
    idempotency_key: key,
  }, { sub: user.sub, userId: userId ?? null, email: user.email, name: user.name, handle, actorType: "human" });
  const block = result.content.find((entry) => entry.type === "text");
  if (result.isError || block?.type !== "text") {
    return error(block?.type === "text" ? block.text : "The capture could not be saved.", 409);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(block.text); } catch { return error("The capture receipt was invalid.", 409); }
  if (!parsed || typeof parsed !== "object") return error("The capture receipt was invalid.", 409);
  const value = parsed as Record<string, unknown>;
  const item = value.item && typeof value.item === "object" ? value.item as Record<string, unknown> : null;
  const receipt = value.receipt && typeof value.receipt === "object" ? value.receipt as Record<string, unknown> : null;
  if (typeof item?.id !== "string" || typeof item.slug !== "string" || receipt?.item_id !== item.id ||
    receipt.saved_to !== folderPath || typeof receipt.title !== "string") {
    return error("The capture receipt did not match the saved item.", 409);
  }
  return Response.json({
    item: { id: item.id, slug: item.slug },
    receipt: { itemId: item.id, savedTo: folderPath, title: receipt.title },
  }, { headers });
}
