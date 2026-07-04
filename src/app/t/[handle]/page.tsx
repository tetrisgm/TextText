import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createPostAndRedirectAction } from "@/app/editor/actions";
import {
  BlogNameForm,
  ClaimBlogButton,
} from "@/components/BlogHomeEditorControls";
import { PostCard } from "@/components/PostCard";
import { BlogHomeShortcuts } from "@/components/PostShortcuts";
import { isAuthConfigured } from "@/auth";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { blogFeedAlternateTypes, blogFeedHref } from "@/lib/feed-links";
import { getCurrentUser } from "@/lib/session";
import { getAllPosts, getBlog, getPosts } from "@/lib/store";
import type { Blog } from "@/lib/content";

interface Props {
  params: Promise<{ handle: string }>;
  searchParams?: Promise<{ claim?: string | string[] }>;
}

function blogStyle(blog: Blog): CSSProperties | undefined {
  return blog.accent
    ? ({ "--post-accent": blog.accent } as CSSProperties)
    : undefined;
}

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isDefaultBlogName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return !normalized || normalized === "untitled blog";
}

function CreatePostForm({ handle }: { handle: string }) {
  return (
    <form
      className="blog-create-form applecms ac-chrome"
      action={createPostAndRedirectAction}
    >
      <input type="hidden" name="handle" value={handle} />
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

export default async function BlogHome({ params, searchParams }: Props) {
  const { handle } = await params;
  const queryPromise: Promise<{ claim?: string | string[] }> =
    searchParams ?? Promise.resolve({});
  const [blog, access, viewer, query] = await Promise.all([
    getBlog(handle),
    getBlogEditAccess(handle),
    getCurrentUser(),
    queryPromise,
  ]);
  if (!blog) notFound();
  const canEdit = access.canEdit;
  const posts = canEdit ? await getAllPosts(handle) : await getPosts(handle);
  const feedHref = blogFeedHref(handle);
  const encodedHandle = encodeURIComponent(handle);
  const showNameForm = canEdit && isDefaultBlogName(blog.name);
  const showClaim = access.isUnclaimed && access.isTokenEditor;
  const feedLinks = [
    { href: feedHref, label: "RSS" },
    { href: `/t/${encodedHandle}/atom.xml`, label: "Atom" },
    { href: `/t/${encodedHandle}/feed.json`, label: "JSON Feed" },
  ];

  return (
    <main className="blog-home" style={blogStyle(blog)}>
      {canEdit && <BlogHomeShortcuts owner={canEdit} handle={handle} />}
      {canEdit && <CreatePostForm handle={handle} />}
      <header className="blog-home-header">
        <div className="blog-home-heading">
          <div className="blog-home-copy">
            {showNameForm ? (
              <BlogNameForm handle={handle} />
            ) : (
              <h1 className="blog-home-name">{blog.name}</h1>
            )}
            <div className="blog-home-meta">
              {blog.tagline && (
                <p className="blog-home-tagline">{blog.tagline}</p>
              )}
            </div>
          </div>
          {showClaim && (
            <ClaimBlogButton
              handle={handle}
              signedIn={Boolean(viewer)}
              authConfigured={isAuthConfigured}
              autoClaim={queryValue(query.claim) === "1"}
            />
          )}
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
              owner={canEdit}
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
