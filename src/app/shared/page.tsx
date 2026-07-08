// /shared: the receive half of item sharing. A signed-in person sees every
// post other people invited them to (as editor or viewer), so a share is
// reachable without hunting for the invite email. Permission reads honor
// unbound email invites without binding them as a side effect.

import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getSharedPostsForUser } from "@/lib/shares";
import { SharedWithMe } from "@/components/workspace/SharedWithMe";
import "./shared.css";

export const metadata: Metadata = {
  title: "Shared with me",
  description: "Posts other people have shared with you.",
};

export default async function SharedPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="applecms shared-shell">
        <main className="shared-main">
          <h1 className="shared-title">Shared with me</h1>
          <p className="shared-lede">
            Sign in to see the posts people have shared with you.
          </p>
          <p>
            <a
              className="ac-btn ac-btn-filled"
              href="/api/auth/signin?callbackUrl=/shared"
            >
              Sign in
            </a>
          </p>
        </main>
      </div>
    );
  }

  const entries = await getSharedPostsForUser({
    sub: user.sub,
    email: user.email,
    name: user.name,
  });

  return (
    <div className="applecms shared-shell">
      <main className="shared-main">
        <Link className="shared-back" href="/start">
          Back to your workspace
        </Link>
        <h1 className="shared-title">Shared with me</h1>
        <p className="shared-lede">
          Posts other people invited you to view or edit.
        </p>
        {entries.length === 0 ? (
          <p className="shared-empty">Nothing has been shared with you yet.</p>
        ) : (
          <SharedWithMe entries={entries} />
        )}
      </main>
    </div>
  );
}
