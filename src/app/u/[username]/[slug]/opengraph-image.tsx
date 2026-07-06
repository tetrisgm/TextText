import { OG_IMAGE_CONTENT_TYPE, OG_IMAGE_SIZE, postOgImage } from "@/lib/og-image";
import { getBlogByUsername, getPost } from "@/lib/store";

interface Props {
  params: Promise<{ username: string; slug: string }>;
}

export const size = OG_IMAGE_SIZE;

export const contentType = OG_IMAGE_CONTENT_TYPE;

export default async function Image({ params }: Props) {
  const { username, slug } = await params;
  const blog = await getBlogByUsername(username).catch(() => null);
  if (!blog) return new Response("Not found", { status: 404 });

  const post = await getPost(blog.handle, slug);
  if (!post) return new Response("Not found", { status: 404 });

  return postOgImage(blog, post);
}
