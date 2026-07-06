import { blogOgImage, OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE } from "@/lib/og-image";
import { getBlogByUsername } from "@/lib/store";

interface Props {
  params: Promise<{ username: string }>;
}

export const size = OG_IMAGE_SIZE;

export const contentType = OG_IMAGE_CONTENT_TYPE;

export default async function Image({ params }: Props) {
  const { username } = await params;
  const blog = await getBlogByUsername(username).catch(() => null);
  if (!blog) return new Response("Not found", { status: 404 });

  return blogOgImage(blog);
}
