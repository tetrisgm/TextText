import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { TagListing } from "@/components/TagListing";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import {
  blogTagPath,
  workspacePublicBaseUrl,
} from "@/lib/public-paths";
import { isPublicOriginRequest } from "@/lib/public-origin";
import { publicSocialMetadata } from "@/lib/public-metadata";
import { publishedPublicLocations } from "@/lib/agent-surface";
import { getBlog, getPublicPostLocations } from "@/lib/store";
import { normalizeTag, normalizeTags } from "@/lib/tags";

interface Props {
  params: Promise<{ handle: string; tag: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, tag: rawTag } = await params;
  const blog = await getBlog(handle);
  const tag = normalizeTag(rawTag);
  if (!blog || !tag) return {};
  const publicBaseUrl = workspacePublicBaseUrl(handle);
  const canonical = `${publicBaseUrl}/tags/${encodeURIComponent(tag)}`;
  const title = `#${tag} · ${blog.name}`;
  const description = `Published posts tagged #${tag}.`;
  return {
    title,
    description,
    alternates: {
      canonical,
      types: blogFeedAlternateTypes(blog, blog.name),
    },
    ...publicSocialMetadata({
      title,
      description,
      url: canonical,
      imageUrl: `${publicBaseUrl}/opengraph-image`,
    }),
  };
}

export async function TagPageForHandle({
  handle,
  rawTag,
  redirectClaimed = true,
}: {
  handle: string;
  rawTag: string;
  redirectClaimed?: boolean;
}) {
  const blog = await getBlog(handle);
  const tag = normalizeTag(rawTag);
  if (!blog || !tag) notFound();
  const publicOrigin = isPublicOriginRequest(await headers());
  if (!publicOrigin && redirectClaimed && blog.username) {
    redirect(blogTagPath(blog, tag));
  }
  const locations = publishedPublicLocations(
    await getPublicPostLocations(handle),
  ).filter((location) => normalizeTags(location.post.tags).includes(tag));
  return (
    <TagListing
      blog={blog}
      handle={handle}
      locations={locations}
      publicOrigin={publicOrigin}
      tag={tag}
    />
  );
}

export default async function TenantTagPage({ params }: Props) {
  const { handle, tag } = await params;
  return <TagPageForHandle handle={handle} rawTag={tag} />;
}
