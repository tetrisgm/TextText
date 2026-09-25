import { NextResponse } from "next/server";
import { requestPublicOrigin } from "@/lib/request-origin";

/**
 * `/favicon.ico`, which nothing on our own pages asks for.
 *
 * Every page declares `/icon`, so a browser loading TextText never looks
 * here. Anything ELSE that links to us does: a feed reader, a link preview,
 * or - as a workspace bookmark of texttext.app turned up - our own bookmark
 * cover, which asks a site for its favicon by the conventional path and got
 * a 404 three times a page load. The convention costs one redirect to the
 * icon we already generate.
 */
export function GET(request: Request): NextResponse {
  return NextResponse.redirect(new URL("/icon", requestPublicOrigin(request)), 308);
}
