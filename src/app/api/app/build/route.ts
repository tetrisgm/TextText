// Which build is serving right now.
//
// The value is inlined at build time, so this answers for the deployment that
// handles the request, not for whatever the runtime environment happens to
// hold. A page compares its own baked id against this one; when they differ,
// the origin has been redeployed since the page loaded.
//
// Deliberately unauthenticated and tiny: it carries no workspace data, and a
// page that cannot reach it should say nothing rather than nag.

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "development" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
