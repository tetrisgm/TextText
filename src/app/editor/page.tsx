import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AccountLinkRequiredError, ensureOwnerBlog } from "@/lib/store";

export default async function EditorPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin?callbackUrl=%2Feditor");

  let handle: string;
  try {
    const blog = await ensureOwnerBlog(user);
    handle = blog.handle;
  } catch (error) {
    if (error instanceof AccountLinkRequiredError) {
      redirect("/signin?error=AccountLinkRequired");
    }
    throw error;
  }
  redirect(`/t/${encodeURIComponent(handle)}`);
}
