// /download is the URL people say out loud; it lands on the app zip.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.redirect(new URL("/download/Write.zip", request.url), 302);
}
