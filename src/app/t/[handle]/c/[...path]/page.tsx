import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CategoryListing } from "@/components/CategoryListing";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import {
  blogCategoryPath,
  resolveCategory,
} from "@/lib/categories";
import { getBlog } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string; path: string[] }>;
}

function categoryTitle(title: string): string {
  return title.trim() || "Untitled";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, path } = await params;
  const blog = await getBlog(handle);
  if (!blog) return {};
  const category = await resolveCategory(handle, path);
  if (!category) return {};
  return {
    title: `${categoryTitle(category.folder.name)} · ${blog.name}`,
    description: `Published posts in ${category.folder.name}.`,
    alternates: {
      types: blogFeedAlternateTypes(blog, blog.name),
    },
  };
}

export async function CategoryPageForHandle({
  handle,
  path,
  redirectClaimed = true,
}: {
  handle: string;
  path: string[];
  redirectClaimed?: boolean;
}) {
  const blog = await getBlog(handle);
  if (!blog) notFound();
  if (redirectClaimed && blog.username) {
    redirect(blogCategoryPath(blog, path));
  }

  const category = await resolveCategory(handle, path);
  if (!category) notFound();

  return (
    <CategoryListing
      blog={blog}
      folder={category.folder}
      folders={category.folders}
      handle={handle}
      posts={category.posts}
    />
  );
}

export default async function TenantCategoryPage({ params }: Props) {
  const { handle, path } = await params;
  return <CategoryPageForHandle handle={handle} path={path} />;
}
