import { genericPublicNotFound } from "@/lib/public-origin";
import { workspacePublicBaseUrl } from "@/lib/public-paths";
import { getBlog } from "@/lib/store";

interface Props {
  params: Promise<{ handle: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { handle } = await params;
  if (!(await getBlog(handle))) return genericPublicNotFound();

  const publicOrigin = workspacePublicBaseUrl(handle);
  return new Response(
    [
      "User-agent: *",
      "Allow: /",
      `Sitemap: ${publicOrigin}/sitemap.xml`,
      `Host: ${publicOrigin}`,
      "",
    ].join("\n"),
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}
