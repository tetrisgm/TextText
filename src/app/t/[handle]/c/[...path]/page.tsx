import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CategoryListing } from "@/components/CategoryListing";
import { blogFeedAlternateTypes } from "@/lib/feed-links";
import {
  blogCategoryPath,
  resolveCategory,
  workspaceCategoryPath,
} from "@/lib/categories";
import { workspacePublicBaseUrl } from "@/lib/public-paths";
import { isPublicOriginRequest } from "@/lib/public-origin";
import { publicSocialMetadata } from "@/lib/public-metadata";
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
  const category = await resolveCategory(handle, path, { publicOnly: true });
  if (!category) return {};
  const publicBaseUrl = workspacePublicBaseUrl(handle);
  const canonical = `${publicBaseUrl}${workspaceCategoryPath(path)}`;
  const title = `${categoryTitle(category.folder.name)} · ${blog.name}`;
  const description = `Published posts in ${category.folder.name}.`;
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
  const publicOrigin = isPublicOriginRequest(await headers());
  if (!publicOrigin && redirectClaimed && blog.username) {
    redirect(blogCategoryPath(blog, path));
  }

  const category = await resolveCategory(handle, path, { publicOnly: publicOrigin });
  if (!category) notFound();

  return (
    <CategoryListing
      blog={blog}
      folder={category.folder}
      folders={category.folders}
      handle={handle}
      posts={category.posts}
      publicOrigin={publicOrigin}
    />
  );
}

export default async function TenantCategoryPage({ params }: Props) {
  const { handle, path } = await params;
  return <CategoryPageForHandle handle={handle} path={path} />;
}
