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
import type { Blog, PostType } from "@/lib/content";

interface Props {
  params: Promise<{ handle: string }>;
}

const TYPE_LABELS: Record<PostType, string> = {
  article: "Article",
  project: "Project",
  talk: "Talk",
};

function blogStyle(blog: Blog): CSSProperties | undefined {
  return blog.accent
    ? ({ "--post-accent": blog.accent } as CSSProperties)
    : undefined;
}

function NewPostForm() {
  return (
    <form className="blog-new-post" action={createPostAndRedirectAction}>
      <select
        className="blog-new-post-select"
        name="type"
        defaultValue="article"
        aria-label="Post type"
      >
        {POST_TYPES.map((type) => (
          <option key={type} value={type}>
            {TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      <button className="blog-new-post-button" type="submit">
        New post
      </button>
    </form>
  );
}

const POST_TYPES: PostType[] = ["article", "project", "talk"];

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

  return (
    <main className="blog-home" style={blogStyle(blog)}>
      {owner && <BlogHomeShortcuts owner={owner} />}
      <header className="blog-home-header">
        <div className="blog-home-heading">
          <div className="blog-home-copy">
            <h1 className="blog-home-name">{blog.name}</h1>
            <div className="blog-home-meta">
              {blog.tagline && (
                <p className="blog-home-tagline">{blog.tagline}</p>
              )}
              <Link
                className="blog-home-feed"
                href={feedHref}
                aria-label={`${blog.name} RSS feed`}
              >
                RSS
              </Link>
            </div>
          </div>
          {owner && <NewPostForm />}
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
    </main>
  );
}
