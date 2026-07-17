import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PostPageForHandle } from "@/app/t/[handle]/[slug]/page";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import { usernamePostPath } from "@/lib/public-paths";
import { getBlogByUsername, getPost } from "@/lib/store";
import { redirectDirectUsernameHit } from "@/lib/username-routes";
import { postSubtitle } from "@/lib/markdown-subtitle";

interface Props {
  params: Promise<{ username: string; slug: string }>;
  searchParams?: Promise<{ edit?: string | string[]; id?: string | string[] }>;
}

function postTitle(title: string): string {
  return title.trim() || "Untitled";
}

async function resolveBlog(username: string) {
  try {
    return await getBlogByUsername(username);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, slug } = await params;
  const blog = await resolveBlog(username);
  if (!blog) return {};
  const post = await getPost(blog.handle, slug);
  if (!post) return {};
  // Never describe a private post (an unlisted note or bookmark, or any
  // unpublished draft) in page metadata; the page itself 404s for anyone who
  // is not the owner or an invited collaborator (same rule as the /t mirror).
  if (
    post.type === "note" ||
    post.type === "bookmark" ||
    post.status !== "published"
  ) {
    return {};
  }
  const metadata: Metadata = {
    title: `${postTitle(post.title)} · ${blog.name}`,
    description:
      postSubtitle(post) || post.body.split(/\n{2,}/)[0]?.slice(0, 160),
    alternates: {
      canonical: usernamePostPath(blog.username ?? username, post.slug),
      types: blogFeedAlternateTypes(blog, blog.name),
    },
  };
  return metadata;
}

export default async function UsernamePostPage({ params, searchParams }: Props) {
  const { username, slug } = await params;
  await redirectDirectUsernameHit(
    usernamePostPath(username, slug),
    await searchParams,
  );
  const blog = await resolveBlog(username);
  if (!blog) notFound();
  return (
    <PostPageForHandle
      handle={blog.handle}
      redirectClaimed={false}
      searchParams={searchParams}
      slug={slug}
    />
  );
}
