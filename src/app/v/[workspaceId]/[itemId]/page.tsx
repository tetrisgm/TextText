import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { plainTextExcerpt } from "@/lib/content";
import { readPublicVaultItem } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
type Props = { params: Promise<{ workspaceId: string; itemId: string }> };
const readPublished = cache((workspaceId: string, itemId: string) =>
  readPublicVaultItem({ workspaceId, itemId }).catch(() => null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspaceId, itemId } = await params;
  const view = await readPublished(workspaceId, itemId);
  if (!view) return { robots: { index: false, follow: false } };
  const title = view.preview.title || "Untitled story";
  const description = plainTextExcerpt(view.preview.subtitle || view.document.content.body, 180);
  const image = view.preview.imageUrl;
  return {
    title,
    description,
    openGraph: {
      type: "article", title, description,
      url: `/v/${encodeURIComponent(workspaceId)}/${encodeURIComponent(itemId)}`,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title, description,
      ...(image ? { images: [image] } : {}) },
  };
}

export default async function PublicVaultPage({ params }: Props) {
  const { workspaceId, itemId } = await params;
  const view = await readPublished(workspaceId, itemId);
  if (!view) notFound();
  return <DocumentRenderer document={view.document} template={view.template}
    documentId={`public-${itemId}`} landmark="main" />;
}
