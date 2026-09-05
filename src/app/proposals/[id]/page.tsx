import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getOwnedBlog, getUserIdBySub } from "@/lib/store";
import { decideWorkspaceWriteProposal, getWorkspaceWriteProposalForReview } from "@/lib/ai/write-proposals.server";
import "@/styles/connect.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review proposed change", robots: { index: false, follow: false } };

async function reviewActor(id: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/proposals/${id}`)}`);
  const blog = await getOwnedBlog(user.sub);
  const userId = user.userId ?? await getUserIdBySub(user.sub);
  if (!blog || !userId) notFound();
  return { sub: user.sub, userId, handle: blog.handle };
}

export default async function ProposalReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = z.string().uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const id = parsed.data;
  const proposal = await getWorkspaceWriteProposalForReview(await reviewActor(id), id);
  if (!proposal) notFound();

  async function approve() {
    "use server";
    await decideWorkspaceWriteProposal({ actor: await reviewActor(id), proposalId: id, decision: "approve" });
    redirect(`/proposals/${id}`);
  }
  async function deny() {
    "use server";
    await decideWorkspaceWriteProposal({ actor: await reviewActor(id), proposalId: id, decision: "deny" });
    redirect(`/proposals/${id}`);
  }

  return (
    <div className="applecms connect-shell">
      <main className="connect-main" style={{ maxWidth: 720 }}>
        <h1 className="connect-title">{proposal.title}</h1>
        {proposal.origin?.surface === "hosted_mcp" && <p>Requested by connected agent: {proposal.origin.connectionName}</p>}
        <p>{proposal.summary}</p>
        <details open>
          <summary>Exact proposed change</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "50vh", overflow: "auto" }}>{JSON.stringify(proposal.arguments, null, 2)}</pre>
        </details>
        <p role="status">{proposal.status === "pending" ? "Waiting for your approval. Nothing has been changed." : `Proposal status: ${proposal.status}.`}</p>
        {proposal.receipt && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{proposal.receipt.text}</pre>}
        {proposal.status === "pending" && (
          <div style={{ display: "flex", gap: 8 }}>
            <form action={approve}><button className="ac-btn ac-btn-gray" type="submit">Approve this change</button></form>
            <form action={deny}><button className="ac-btn ac-btn-gray" type="submit">Dismiss</button></form>
          </div>
        )}
      </main>
    </div>
  );
}
