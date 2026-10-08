import { POST as authPost } from "@/auth";
import { appleCallbackPage } from "@/lib/apple-callback-resume";
import type { NextRequest } from "next/server";
export { GET } from "@/auth";
export async function POST(request: NextRequest) {
  return request.nextUrl.pathname === "/api/auth/callback/apple" ? appleCallbackPage(request) : authPost(request);
}
