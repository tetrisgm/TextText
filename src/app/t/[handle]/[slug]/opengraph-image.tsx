import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE, postOgImage } from "@/lib/og-image";
import { getBlog, getPost } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
}

export const size = OG_IMAGE_SIZE;

export const contentType = OG_IMAGE_CONTENT_TYPE;

export default async function Image({ params }: Props) {
  const { handle, slug } = await params;
  const [blog, post] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
  ]);
  // Private posts (unpublished drafts, and notes/bookmarks which are unlisted
  // forever) 404 for anyone who cannot edit, so their title, excerpt, and
  // cover must not leak through a publicly rendered OG image either.
  if (
    !blog ||
    !post ||
    post.status !== "published" ||
    post.type === "note" ||
    post.type === "bookmark"
  ) {
    return new Response("Not found", { status: 404 });
  }

  return postOgImage(blog, post);
}
