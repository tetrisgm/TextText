import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CategoryPageForHandle } from "@/app/t/[handle]/c/[...path]/page";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import { resolveCategory, usernameCategoryPath } from "@/lib/categories";
import { getBlogByUsername } from "@/lib/store";
import { redirectDirectUsernameHit } from "@/lib/username-routes";

interface Props {
  params: Promise<{ username: string; path: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function categoryTitle(title: string): string {
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
  const { username, path } = await params;
  const blog = await resolveBlog(username);
  if (!blog) return {};
  const category = await resolveCategory(blog.handle, path);
  if (!category) return {};
  return {
    title: `${categoryTitle(category.folder.name)} · ${blog.name}`,
    description: `Published posts in ${category.folder.name}.`,
    alternates: {
      canonical: usernameCategoryPath(blog.username ?? username, path),
      types: blogFeedAlternateTypes(blog, blog.name),
    },
  };
}

export default async function UsernameCategoryPage({
  params,
  searchParams,
}: Props) {
  const { username, path } = await params;
  await redirectDirectUsernameHit(
    usernameCategoryPath(username, path),
    await searchParams,
  );
  const blog = await resolveBlog(username);
  if (!blog) notFound();
  return (
    <CategoryPageForHandle
      handle={blog.handle}
      path={path}
      redirectClaimed={false}
    />
  );
}
