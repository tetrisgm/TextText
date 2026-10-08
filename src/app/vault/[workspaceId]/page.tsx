import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getVaultWorkspaceIdentity } from "@/lib/store";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { activeVaultGrants } from "@/lib/vault/grants";
import { WebVault } from "@/local-vault/WebVault";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace", robots: { index: false, follow: false } };

export default async function VaultPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ item?: string | string[]; template?: string | string[] }>;
}) {
  const { workspaceId } = await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(workspaceId)) notFound();
  const query = await searchParams;
  const requestedItem = query.item;
  const item = typeof requestedItem === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(requestedItem) ? requestedItem : null;
  const callbackQuery = new URLSearchParams();
  if (item) callbackQuery.set("item", item);
  if (typeof query.template === "string" && /^[a-z][a-z0-9-]{0,80}$/.test(query.template)) callbackQuery.set("template", query.template);
  const user = await getCurrentUser();
  if (!user) redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/vault/${workspaceId}${callbackQuery.size ? `?${callbackQuery.toString()}` : ""}`)}`);
  const blog = await getVaultWorkspaceIdentity(workspaceId);
  if (!blog) notFound();
  const access = await resolveWorkspaceAccess({ handle: blog.handle, user, fresh: true });
  if (access.blogId !== workspaceId || !access.userId) notFound();
  if (!access.isOwner && !access.canView) {
    const root = process.env.TEXTTEXT_VAULT_ROOT;
    if (!root || !(await activeVaultGrants({ root, workspaceId, userId: access.userId })).length) notFound();
  }
  return <WebVault requestedTemplate={typeof query.template === "string" ? query.template : undefined} workspaceId={workspaceId} name={blog.name} accountEmail={user.email ?? null} accountName={user.name ?? null} />;
}
