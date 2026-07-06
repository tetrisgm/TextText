import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BlogHomeForHandle } from "@/app/t/[handle]/page";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import { usernameHomePath } from "@/lib/public-paths";
import { getBlogByUsername } from "@/lib/store";
import { redirectDirectUsernameHit } from "@/lib/username-routes";

interface Props {
  params: Promise<{ username: string }>;
  searchParams?: Promise<{
    card?: string | string[];
    claim?: string | string[];
    layout?: string | string[];
  }>;
}

async function resolveBlog(username: string) {
  try {
    return await getBlogByUsername(username);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const blog = await resolveBlog(username);
  if (!blog) return {};
  return {
    title: blog.name,
    description: blog.tagline,
    alternates: {
      canonical: usernameHomePath(blog.username ?? username),
      types: blogFeedAlternateTypes(blog, blog.name),
    },
  };
}

export default async function UsernameBlogHome({
  params,
  searchParams,
}: Props) {
  const { username } = await params;
  await redirectDirectUsernameHit(
    usernameHomePath(username),
    await searchParams,
  );
  const blog = await resolveBlog(username);
  if (!blog) notFound();
  return (
    <BlogHomeForHandle
      handle={blog.handle}
      redirectClaimed={false}
      searchParams={searchParams}
    />
  );
}
