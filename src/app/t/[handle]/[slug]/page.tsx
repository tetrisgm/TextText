import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getBlog, getPost, isBlogOwner } from "@/lib/store";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import { ProjectReader } from "@/components/ProjectReader";
import { PostEditLayer } from "@/components/PostEditLayer";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
  searchParams?: Promise<{ edit?: string | string[] }>;
}

const VISIBILITY_LABELS = {
  published: "Public",
  draft: "Unlisted",
} as const;

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function postTitle(title: string): string {
  return title.trim() || "Untitled";
}

function postPath(handle: string, slug: string): string {
  return `/t/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
}

function OwnerPostControls({
  handle,
  slug,
  status,
}: {
  handle: string;
  slug: string;
  status: "draft" | "published";
}) {
  return (
    <div className="post-owner-floating" aria-label="Post controls">
      <span className={`post-owner-visibility is-${status}`}>
        {VISIBILITY_LABELS[status]}
      </span>
      <Link className="post-owner-edit" href={`${postPath(handle, slug)}?edit=1`}>
        Edit
      </Link>
    </div>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params;
  const [blog, post] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
  ]);
  if (!blog || !post) return {};
  const metadata: Metadata = {
    title: `${postTitle(post.title)} · ${blog.name}`,
    description: post.body.split(/\n{2,}/)[0]?.slice(0, 160),
  };
  if (post.status !== "published") {
    metadata.robots = { index: false, follow: false };
  }
  return metadata;
}

export default async function PostPage({ params, searchParams }: Props) {
  const { handle, slug } = await params;
  const [blog, post, viewer] = await Promise.all([
    getBlog(handle),
    getPost(handle, slug),
    getCurrentUser(),
  ]);
  const query = searchParams ? await searchParams : {};
  if (!blog || !post) notFound();
  const owner = viewer ? await isBlogOwner(handle, viewer.sub) : false;
  const editMode = owner && queryValue(query.edit) === "1";

  const ReaderComponent =
    post.type === "talk"
      ? TalkReader
      : post.type === "project"
        ? ProjectReader
        : Reader;

  if (editMode) return <PostEditLayer blog={blog} post={post} />;

  return (
    <>
      {owner && (
        <OwnerPostControls handle={handle} slug={post.slug} status={post.status} />
      )}
      <ReaderComponent blog={blog} post={post} />
    </>
  );
}
