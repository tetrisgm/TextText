import {
  blogBaseUrl,
  locatedPostMarkdownUrl,
  locatedPostUrl,
  notFound,
  publishedNewestFirst,
} from "@/lib/agent-surface";
import { markdownFileHash } from "@/lib/content-hash";
import { renderFolderManifest } from "@/lib/markdown-files";
import { getBlog, getFolders, getPublicPostLocations } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string }>;
}

const CACHE_CONTROL = "public, max-age=0, must-revalidate";

export async function GET(request: Request, { params }: Props) {
  const { handle } = await params;
  const [blog, locations] = await Promise.all([
    getBlog(handle),
    getPublicPostLocations(handle),
  ]);
  if (!blog) return notFound();

  const folders = await getFolders(handle);
  const folder = folders.find((entry) => entry.path === "blog");
  const baseUrl = blogBaseUrl(blog);
  const posts = publishedNewestFirst(locations.map((location) => location.post));
  const locationFor = (post: (typeof posts)[number]) =>
    locations.find((candidate) => candidate.post.id === post.id)!;
  const manifest = renderFolderManifest(blog, posts, {
    folder,
    fileUrlFor: (post) => locatedPostMarkdownUrl(baseUrl, locationFor(post)),
    includePersonalMetadata: false,
    postUrlFor: (post) => locatedPostUrl(baseUrl, locationFor(post)),
  });

  const json = JSON.stringify(manifest, null, 2);
  const etag = `"${markdownFileHash(json)}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatchSatisfied(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers: { "Cache-Control": CACHE_CONTROL, ETag: etag },
    });
  }

  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
      ETag: etag,
    },
  });
}

// RFC 9110 section 13.1.2: If-None-Match uses the WEAK comparison, so a
// proxy-weakened W/"hash" (nginx does this when it gzips) still revalidates,
// and a bare "*" matches any current representation.
function ifNoneMatchSatisfied(headerValue: string, etag: string): boolean {
  if (headerValue.trim() === "*") return true;
  return headerValue
    .split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}
