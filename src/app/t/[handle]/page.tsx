import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createPostAndRedirectAction } from "@/app/editor/actions";
import { PostCard } from "@/components/PostCard";
import { BlogHomeShortcuts } from "@/components/PostShortcuts";
import { blogFeedAlternateTypes, blogFeedHref } from "@/lib/feed-links";
import { getCurrentUser } from "@/lib/session";
import { getAllPosts, getBlog, getPosts, isBlogOwner } from "@/lib/store";
import type { Blog } from "@/lib/content";

interface Props {
  params: Promise<{ handle: string }>;
}

function blogStyle(blog: Blog): CSSProperties | undefined {
  return blog.accent
    ? ({ "--post-accent": blog.accent } as CSSProperties)
    : undefined;
}

function CreatePostForm() {
  return (
    <form
      className="blog-create-form applecms ac-chrome"
      action={createPostAndRedirectAction}
    >
      <input type="hidden" name="type" value="article" />
      <button className="blog-create-button ac-btn ac-btn-filled" type="submit">
        Create
      </button>
    </form>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return {};
  return {
    title: blog.name,
    description: blog.tagline,
    alternates: {
      types: blogFeedAlternateTypes(handle, blog.name),
    },
  };
}

export default async function BlogHome({ params }: Props) {
  const { handle } = await params;
  const [blog, viewer] = await Promise.all([getBlog(handle), getCurrentUser()]);
  if (!blog) notFound();
  const owner = viewer ? await isBlogOwner(handle, viewer.sub) : false;
  const posts = owner ? await getAllPosts(handle) : await getPosts(handle);
  const feedHref = blogFeedHref(handle);
  const encodedHandle = encodeURIComponent(handle);
  const feedLinks = [
    { href: feedHref, label: "RSS" },
    { href: `/t/${encodedHandle}/atom.xml`, label: "Atom" },
    { href: `/t/${encodedHandle}/feed.json`, label: "JSON Feed" },
  ];

  return (
    <main className="blog-home" style={blogStyle(blog)}>
      {owner && <BlogHomeShortcuts owner={owner} />}
      {owner && <CreatePostForm />}
      <header className="blog-home-header">
        <div className="blog-home-heading">
          <div className="blog-home-copy">
            <h1 className="blog-home-name">{blog.name}</h1>
            <div className="blog-home-meta">
              {blog.tagline && (
                <p className="blog-home-tagline">{blog.tagline}</p>
              )}
            </div>
          </div>
        </div>
      </header>

      {posts.length > 0 && (
        <div className="tv-grid">
          {posts.map((post) => (
            <PostCard
              key={post.slug}
              blog={blog}
              handle={handle}
              post={post}
              owner={owner}
            />
          ))}
        </div>
      )}

      <footer className="blog-home-footer" aria-label="Feeds">
        <span className="blog-home-footer-label">Feeds</span>
        {feedLinks.map((feed) => (
          <Link
            key={feed.href}
            className="blog-home-footer-link"
            href={feed.href}
            aria-label={`${blog.name} ${feed.label} feed`}
          >
            {feed.label}
          </Link>
        ))}
      </footer>
    </main>
  );
}
