import { useCallback, useEffect, useRef, useState } from "react";
import { vaultRequest } from "./bridge";

export type AssistantWriteProposal = { id: string; kind: "workspace"; title: string; summary: string; arguments: Record<string, unknown>; expiresAt: string };
type Card = AssistantWriteProposal & { verified?: boolean; state?: "pending" | "uncertain" | "completed" | "denied" | "failed"; message?: string; decision?: "approve" | "deny" };
export function AssistantWriteProposals({ root, path, proposals, beforeApprove }: { root: string; path: string; proposals: AssistantWriteProposal[]; beforeApprove: () => Promise<boolean> }) {
  const key = `texttext:assistant-proposals:${root}:${path}`;
  const [cards, setCards] = useState<Card[]>(() => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.slice(-12).filter(item => item?.kind === "workspace" && typeof item.id === "string").map(item => ({...item, verified:false})) : []; } catch { return []; } });
  const cardsRef = useRef(cards); cardsRef.current = cards;
  const [storageNotice, setStorageNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const save = useCallback((change: (current: Card[]) => Card[]) => {
    const next = change(cardsRef.current); cardsRef.current = next;
    try { localStorage.setItem(key, JSON.stringify(next.map(({id,kind,state,decision}) => ({id,kind,state,decision})))); }
    catch { if (alive.current) setStorageNotice("Keep this panel open to review these changes. This browser could not remember the proposal list."); }
    if (alive.current) setCards(next);
  }, [key]);
  useEffect(() => {
    if (!proposals.length) return;
    save(previous => [...previous, ...proposals.filter(proposal => !previous.some(card => card.id === proposal.id))].slice(-12));
    // Proposal arrival merges against the latest in-flight decisions.
  }, [save, proposals]);
  const ids = cards.map(card => card.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    for (const id of ids.split(",").filter(Boolean)) void (async () => {
      try {
        const response = await fetch(`/api/ai/proposals/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload.proposal?.id !== id) throw new Error("This proposed change is unavailable.");
        const proposal = payload.proposal;
        setCards(previous => previous.map(card => card.id !== id ? card : { ...card, ...proposal, verified: true,
          state: proposal.status === "pending" ? card.state ?? "pending" : proposal.status === "executing" ? "uncertain" : proposal.status === "completed" ? "completed" : proposal.status === "denied" ? "denied" : "failed",
          message: proposal.receipt?.text ?? card.message }));
      } catch (error) { if (!controller.signal.aborted) setCards(previous => previous.map(card => card.id !== id ? card : {...card, verified:false, message:error instanceof Error ? error.message : "Review unavailable."})); }
    })();
    return () => controller.abort();
  }, [ids]);
  const decide = async (card: Card, decision: "approve" | "deny") => {
    if (busy || !card.verified) return;
    setBusy(card.id);
    let sent = false;
    try {
      if (decision === "approve" && !await beforeApprove()) throw new Error("Finish saving this item before approving the change.");
      if (!alive.current) return;
      // Persist uncertainty before sending. A lost response retries this exact proposal, never a new command.
      save(current => current.map(item => item.id === card.id ? { ...item, state: "uncertain", decision, message: "Checking the saved result…" } : item));
      sent = true;
      const response = await fetch(`/api/ai/proposals/${encodeURIComponent(card.id)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const result = await response.json();
      const state: Card["state"] = response.ok && result.receipt ? "completed" : response.ok && result.status === "denied" ? "denied" : (response.status === 202 || response.status >= 500) ? "uncertain" : "failed";
      const message = result.receipt?.text || result.message || result.error || (state === "denied" ? "Change rejected." : "Change saved.");
      save(current => current.map(item => item.id === card.id ? { ...item, state, message, decision } : item));
      if (state === "completed" && alive.current) { await vaultRequest("list").catch(() => {}); window.dispatchEvent(new Event("texttext:vault-changed")); }
    } catch (error) {
      save(current => current.map(item => item.id === card.id ? { ...item, state: sent ? "uncertain" : card.state, decision: sent ? decision : card.decision, message: error instanceof Error ? error.message : "The result could not be checked." } : item));
    } finally { if (alive.current) setBusy(null); }
  };
  return <section aria-label="Proposed changes">{storageNotice && <p role="status">{storageNotice}</p>}{cards.map(card => <article key={card.id}>
    <h3>{card.title}</h3><p>{card.summary}</p>
    <details><summary>Review exact change</summary><pre>{JSON.stringify(card.arguments, null, 2)}</pre></details>
    {card.message && <p role="status">{card.message}</p>}
    {(!card.state || card.state === "pending" || card.state === "uncertain") && <>
      <button disabled={busy !== null || !card.verified} onClick={() => void decide(card, card.state === "uncertain" ? card.decision ?? "approve" : "approve")}>{card.state === "uncertain" ? "Check result" : "Approve change"}</button>
      {card.state !== "uncertain" && <button disabled={busy !== null || !card.verified} onClick={() => void decide(card, "deny")}>Reject change</button>}
    </>}
  </article>)}</section>;
}
