import { oauthAuthorizationServerMetadata } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const issuer = new URL(request.url).origin;
  return Response.json(oauthAuthorizationServerMetadata(issuer), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
