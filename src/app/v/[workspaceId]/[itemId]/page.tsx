import { notFound } from "next/navigation";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { readPublicVaultItem } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
type Props = { params: Promise<{ workspaceId: string; itemId: string }> };

export default async function PublicVaultPage({ params }: Props) {
  const { workspaceId, itemId } = await params;
  const view = await readPublicVaultItem({ workspaceId, itemId }).catch(() => null);
  if (!view) notFound();
  return <DocumentRenderer document={view.document} template={view.template}
    documentId={`public-${itemId}`} landmark="main" />;
}
