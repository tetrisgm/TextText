import { NextRequest, NextResponse } from "next/server";
import { documentCapabilityCookieName } from "@/lib/document-capability";
import {
  getBlog,
  getPostStoreContext,
  resolveDocumentCapability,
} from "@/lib/store";
import { blogPostPath } from "@/lib/public-paths";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const capability = await resolveDocumentCapability(token);
  if (!capability) {
    return new NextResponse("This access link is invalid or has expired.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const context = await getPostStoreContext(capability.itemId);
  const blog = context ? await getBlog(context.handle) : null;
  if (!context || !blog) {
    return new NextResponse("This document is no longer available.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const response = NextResponse.redirect(
    new URL(blogPostPath(blog, context.post), request.url),
    303,
  );
  response.cookies.set(
    documentCapabilityCookieName(capability.itemId),
    token,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
