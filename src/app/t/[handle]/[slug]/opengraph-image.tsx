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
  if (!blog || !post) return new Response("Not found", { status: 404 });

  return postOgImage(blog, post);
}
