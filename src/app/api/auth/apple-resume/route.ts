import { POST as authPost } from "@/auth";
import { resumeAppleCallback } from "@/lib/apple-callback-resume";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return resumeAppleCallback(request, authPost); }
