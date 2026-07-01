import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBlog, getPosts } from "@/lib/store";
import { formatArticleDate, readingTimeMin } from "@/lib/content";

interface Props {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return {};
  return {
    title: blog.name,
    description: blog.tagline,
  };
}

export default async function BlogHome({ params }: Props) {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) notFound();
  const posts = await getPosts(handle);
  const style = blog.accent
    ? ({ "--post-accent": blog.accent } as CSSProperties)
    : undefined;

  return (
    <main className="blog-home" style={style}>
      <h1 className="blog-home-name">{blog.name}</h1>
      {blog.tagline && <p className="blog-home-tagline">{blog.tagline}</p>}
      <div>
        {posts.map((p) => (
          <Link key={p.slug} href={`/t/${handle}/${p.slug}`} className="postrow">
            <span className="postrow-title">{p.title}</span>
            <div className="postrow-meta">
              {[formatArticleDate(p.date), `${readingTimeMin(p.body)} min read`]
                .filter(Boolean)
                .join("  ·  ")}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
