import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TagPageForHandle } from "@/app/t/[handle]/tags/[tag]/page";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import { usernameTagPath } from "@/lib/public-paths";
import { getBlogByUsername } from "@/lib/store";
import { normalizeTag } from "@/lib/tags";
import { redirectDirectUsernameHit } from "@/lib/username-routes";

interface Props {
  params: Promise<{ username: string; tag: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

async function resolveBlog(username: string) {
  try {
    return await getBlogByUsername(username);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, tag: rawTag } = await params;
  const blog = await resolveBlog(username);
  const tag = normalizeTag(rawTag);
  if (!blog || !tag) return {};
  return {
    title: `#${tag} · ${blog.name}`,
    description: `Published posts tagged #${tag}.`,
    alternates: {
      canonical: usernameTagPath(blog.username ?? username, tag),
      types: blogFeedAlternateTypes(blog, blog.name),
    },
  };
}

export default async function UsernameTagPage({ params, searchParams }: Props) {
  const { username, tag } = await params;
  const normalized = normalizeTag(tag);
  if (!normalized) notFound();
  await redirectDirectUsernameHit(
    usernameTagPath(username, normalized),
    await searchParams,
  );
  const blog = await resolveBlog(username);
  if (!blog) notFound();
  return (
    <TagPageForHandle
      handle={blog.handle}
      rawTag={normalized}
      redirectClaimed={false}
    />
  );
}
