// /shared: the receive half of item sharing. A signed-in person sees every
// post other people invited them to (as editor or viewer), so a share is
// reachable without hunting for the invite email. Permission reads honor
// unbound email invites without binding them as a side effect.

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getSharedPostsForUser } from "@/lib/shares";
import { SharedWithMe } from "@/components/workspace/SharedWithMe";
import { SharedVaults } from "./SharedVaults";
import "./shared.css";

export const metadata: Metadata = {
  title: "Shared with me",
  description: "Items and workspaces other people have shared with you.",
};

export default async function SharedPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="applecms shared-shell">
        <main className="shared-main">
          <h1 className="shared-title">Shared with me</h1>
          <p className="shared-lede">
            Sign in to see the items and workspaces people have shared with you.
          </p>
          <form action="/api/auth/signin" method="get">
            <input type="hidden" name="callbackUrl" value="/shared" />
            <button className="ac-btn ac-btn-filled" type="submit">
              Sign in
            </button>
          </form>
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
        <a className="shared-back" href="/start">
          Back to your workspace
        </a>
        <h1 className="shared-title">Shared with me</h1>
        <p className="shared-lede">
          Items and workspaces other people invited you to join, view, comment on, or edit.
        </p>
        <SharedVaults />
        <section className="shared-section" aria-labelledby="shared-posts-title">
          <h2 id="shared-posts-title">Shared posts</h2>
          {entries.length === 0 ? <p className="shared-empty">No posts have been shared with you yet.</p> : <SharedWithMe entries={entries} />}
        </section>
      </main>
    </div>
  );
}
