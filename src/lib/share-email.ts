// Share invite notifications, sent over the same plain SMTP transport as the
// sign-in magic links (AUTH_EMAIL_SERVER / AUTH_EMAIL_FROM; MXroute, never a
// paid email API). Absent email config, invites still work: the row exists
// and the invitee finds the post under "Shared with me" after signing in
// with the invited address; only the notification is skipped.

import type { Blog, Post } from "@/lib/content";
import { getBlog } from "@/lib/store";
import { blogPostPath } from "@/lib/public-paths";
import { rootDomainUrl } from "@/lib/site-url";

export async function sendShareInviteEmail(opts: {
  to: string;
  role: "editor" | "viewer";
  post: Post;
  handle: string;
  inviterName: string;
}): Promise<void> {
  const server = process.env.AUTH_EMAIL_SERVER;
  const from =
    process.env.AUTH_EMAIL_FROM ?? "Texttext <noreply@texttext.app>";
  if (!server || !from) return;

  const blog = await getBlog(opts.handle).catch(() => null);
  const path = blogPostPath(
    (blog ?? { handle: opts.handle }) as Pick<Blog, "handle" | "username">,
    { slug: opts.post.slug },
  );
  const origin = rootDomainUrl().toString().replace(/\/$/, "");
  const url = `${origin}${path}`;
  const verb = opts.role === "editor" ? "edit" : "read";
  const title = opts.post.title.trim() || "an untitled draft";

  const { createTransport } = await import("nodemailer");
  const transport = createTransport(server);
  await transport.sendMail({
    to: opts.to,
    from,
    subject: `${opts.inviterName} shared "${title}" with you`,
    text: [
      `${opts.inviterName} invited you to ${verb} "${title}".`,
      "",
      `Open it: ${url}`,
      "",
      `Sign in with this email address (${opts.to}) to get access.`,
    ].join("\n"),
  });
}
