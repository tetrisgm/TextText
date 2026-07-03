import { redirect } from "next/navigation";
import { SignInScreen } from "@/components/editor/SignInScreen";
import { getCurrentUser } from "@/lib/session";
import { ensureOwnerBlog } from "@/lib/store";

export default async function EditorPage() {
  const user = await getCurrentUser();
  if (!user) return <SignInScreen />;

  const blog = await ensureOwnerBlog(user);
  redirect(`/t/${encodeURIComponent(blog.handle)}`);
}
