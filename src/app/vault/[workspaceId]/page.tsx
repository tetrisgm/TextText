import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog } from "@/lib/store";
import { resolveWorkspaceAccess } from "@/lib/permissions";
import { WebVault } from "@/local-vault/WebVault";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspace", robots: { index: false, follow: false } };

export default async function VaultPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(workspaceId)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/vault/${workspaceId}`)}`);
  const blog = await getOwnedBlog(user.sub);
  if (!blog) notFound();
  const access = await resolveWorkspaceAccess({ handle: blog.handle, user });
  if (!access.isOwner || access.blogId !== workspaceId) notFound();
  return <WebVault workspaceId={workspaceId} name={blog.name} />;
}
