import { notFound } from "@/lib/agent-surface";
import { resolveLegacyPublicSlug } from "@/lib/store";
import { workspacePublicPostUrl } from "@/lib/public-paths";

interface Props {
  params: Promise<{ handle: string; slug: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { handle, slug } = await params;
  const resolution = await resolveLegacyPublicSlug(handle, slug);
  if (resolution.kind !== "redirect") return notFound();
  const target = workspacePublicPostUrl(
    handle,
    resolution.folderPath,
    resolution.post.slug,
  );
  if (!target) return notFound();
    return new Response(null, {
      status: 307,
      headers: {
        Location: `${target}/index.md`,
        "Cache-Control": "private, no-store",
      },
    });
}
