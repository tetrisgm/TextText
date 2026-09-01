import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { PostPageForHandle } from "@/app/t/[handle]/[slug]/page";
import { PostActionBar } from "@/components/PostActionBar";
import { PostShortcuts } from "@/components/PostShortcuts";
import { UnifiedDocumentReader } from "@/components/document/UnifiedDocumentReader";
import { legacyTemplateId } from "@/lib/documents/legacy";
import { postSubtitle } from "@/lib/markdown-subtitle";
import {
  platformReportUrl,
  publicFolderPath,
  workspacePublicPostPath,
  workspacePublicPostUrl,
} from "@/lib/public-paths";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { isPublicOriginRequest } from "@/lib/public-origin";
import { publicSocialMetadata } from "@/lib/public-metadata";
import { publishedPublicLocations } from "@/lib/agent-surface";
import {
  getBlog,
  getDocumentTemplate,
  getPostStoreContext,
  getPublicPostLocations,
  resolvePublicPostPath,
} from "@/lib/store";

interface Props {
  params: Promise<{ handle: string; path: string[] }>;
  searchParams?: Promise<{ edit?: string | string[]; id?: string | string[] }>;
}

function locationFrom(path: readonly string[]): {
  folderPath: string;
  slug: string;
} | null {
  if (path.length < 2) return null;
  const slug = path.at(-1) ?? "";
  const folderPath = path.slice(0, -1).join("/");
  return publicFolderPath(folderPath) === folderPath
    ? { folderPath, slug }
    : null;
}

function title(value: string): string {
  return value.trim() || "Untitled";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, path } = await params;
  const location = locationFrom(path);
  if (!location) return {};
  const [blog, resolution] = await Promise.all([
    getBlog(handle),
    resolvePublicPostPath(handle, location.folderPath, location.slug),
  ]);
  if (!blog || resolution.kind !== "exact") return {};
  const canonical = workspacePublicPostUrl(
    handle,
    resolution.folderPath,
    resolution.post.slug,
  );
  const pageTitle = `${title(resolution.post.title)} · ${blog.name}`;
  const description =
    postSubtitle(resolution.post) ||
    resolution.post.body.split(/\n{2,}/)[0]?.slice(0, 160);
  return {
    title: pageTitle,
    description,
    alternates: canonical ? { canonical } : undefined,
    ...(canonical
      ? publicSocialMetadata({
          title: pageTitle,
          description,
          url: canonical,
          imageUrl: `${canonical}/opengraph-image`,
        })
      : {}),
  };
}

export default async function WorkspacePublicPost({ params, searchParams }: Props) {
  const { handle, path } = await params;
  const requested = locationFrom(path);
  if (!requested) notFound();
  if (!isPublicOriginRequest(await headers())) {
    return (
      <PostPageForHandle
        handle={handle}
        folderPath={requested.folderPath}
        searchParams={searchParams}
        slug={requested.slug}
      />
    );
  }
  const [blog, resolution, unfilteredLocations] = await Promise.all([
    getBlog(handle),
    resolvePublicPostPath(handle, requested.folderPath, requested.slug),
    getPublicPostLocations(handle),
  ]);
  if (!blog || resolution.kind === "missing") notFound();
  if (resolution.kind === "redirect") {
    const destination = workspacePublicPostUrl(
      handle,
      resolution.folderPath,
      resolution.post.slug,
    );
    if (!destination) notFound();
    redirect(destination);
  }

  const post = resolution.post;
  const locations = publishedPublicLocations(unfilteredLocations);
  const currentPath = workspacePublicPostPath(
    resolution.folderPath,
    post.slug,
  );
  if (!currentPath) notFound();
  const index = locations.findIndex(
    (location) => location.post.id === post.id,
  );
  const previous = index > 0 ? locations[index - 1] : undefined;
  const next = index >= 0 ? locations[index + 1] : undefined;
  const previousPath = previous
    ? workspacePublicPostPath(previous.folderPath, previous.post.slug) ?? undefined
    : undefined;
  const nextPath = next
    ? workspacePublicPostPath(next.folderPath, next.post.slug) ?? undefined
    : undefined;
  const adjacent = {
    previous: previous?.post ?? null,
    next: next?.post ?? null,
  };
  const postContext = post.id ? await getPostStoreContext(post.id) : null;
  const reference =
    post.template ??
    post.document?.presentation.template ?? {
      id: legacyTemplateId(post.type),
      version: 1,
    };
  const template =
    (postContext
      ? await getDocumentTemplate(postContext.blogId, reference)
      : null) ?? requireBuiltinTemplate(legacyTemplateId(post.type));
  const reader = (
    <UnifiedDocumentReader blog={blog} post={post} template={template} />
  );

  return (
    <>
      <PostActionBar
        mode="read"
        owner={false}
        blog={blog}
        post={post}
        adjacent={adjacent}
        homePath="/"
        postPath={currentPath}
        previousPath={previousPath}
        nextPath={nextPath}
        canEditPost={false}
        canManagePost={false}
        canCommentPost={false}
      />
      {reader}
      <footer className="public-report-footer">
        <a
          href={platformReportUrl(currentPath, post.id)}
          rel="nofollow"
        >
          Report this page
        </a>
      </footer>
      <PostShortcuts
        homePath="/"
        previousPath={previousPath}
        nextPath={nextPath}
        owner={false}
        handle={handle}
      />
    </>
  );
}
