import type { VaultTransport } from "./bridge";

/** HTTPS adapter for the shared assistant surface with explicit proposal review. No native OAuth is used. */
export function createWebAssistant(handle: string, read: VaultTransport, fetcher: typeof fetch = fetch,
  emit: (event: Record<string, unknown>) => void = event => window.dispatchEvent(new CustomEvent("texttext:vault-agent", { detail: event })), reviewWrites = false) {
  let active: { taskId: string; controller: AbortController } | null = null;
  let closed = false;
  let historyPath = "";
  let history: { role: "user" | "assistant"; content: string }[] = [];
  const cancel = () => { const turn = active; active = null; turn?.controller.abort(); if (turn) emit({ type: "turn-cancelled", taskId: turn.taskId }); };
  return {
    destroy() { closed = true; cancel(); },
    async request(method: string, params: Record<string, unknown>) {
      if (closed) throw new Error("This workspace has closed.");
      if (method === "agentRetarget") { if (historyPath !== params.path) { historyPath = typeof params.path === "string" ? params.path : ""; history = []; } return {}; }
      if (method === "agentCancel") { if (!params.taskId || params.taskId === active?.taskId) cancel(); return {}; }
      if (method === "agentStatus") {
        const response = await fetcher(`/api/ai?workspaceHandle=${encodeURIComponent(handle)}`, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("The workspace assistant is unavailable.");
        const status = await response.json();
        return { state: status.enabled ? "ready" : "disconnected", message: status.enabled ? `${status.provider} · ${reviewWrites ? "Changes need approval" : "Read only"}` : "Connect a workspace AI provider to use the web assistant. Desktop ChatGPT sign-in is separate." };
      }
      if (method !== "agentSend") throw new Error("This action is not available in the web assistant.");
      if (active || typeof params.taskId !== "string" || typeof params.path !== "string" || typeof params.prompt !== "string" || (params.customizing && !reviewWrites)) throw new Error("Open an item with proposal review to customize its design.");
      if (historyPath !== params.path) { historyPath = params.path; history = []; }
      const request = params.prompt.slice(0, 12000);
      const prompt = params.customizing ? `Customize the selected file's presentation while preserving all writing and assets. Read its current hash and list validated templates. Propose set_item_template for an existing built-in or pinned custom template. For a new design, propose create_item_type or update_item_type first; saving that reusable template does not apply it. Wait for that approval, then read the saved source and propose set_item_template in a separate turn with separate approval. Never claim an unapplied design changed this file.\n\nDesign request: ${request}` : request;
      const turn = { taskId: params.taskId, controller: new AbortController() }; active = turn;
      const send = (event: Record<string, unknown>) => { if (!closed && active === turn) emit({ ...event, taskId: turn.taskId }); };
      try {
        const file = await read("read", { path: params.path }, turn.controller.signal) as { markdown: string };
        const { packIdentity } = await import("./pack");
        if (closed || active !== turn || turn.controller.signal.aborted) return {};
        const id = packIdentity(file.markdown); if (!id) throw new Error("This item is unavailable.");
        const response = await fetcher("/api/ai", { method: "POST", credentials: "same-origin", signal: turn.controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceHandle: handle, stream: true,
            messages: [...history, { role: "user", content: prompt }], context: { postId: id, includeItem: true, mode: reviewWrites ? "workspace_review" : "read_only" } }) });
        if (!response.ok || !response.body) throw new Error("The workspace assistant could not start. Check its provider connection.");
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "", total = 0, complete = false;
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            total += chunk.value.byteLength; if (total > 1024 * 1024) throw new Error("The assistant response is too large.");
            buffer += decoder.decode(chunk.value, { stream: true });
            let newline;
            while ((newline = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (!line.trim()) continue;
              const event = JSON.parse(line);
              if (event.type === "text") send({ type: "text-delta", text: event.text });
              else if (event.type === "progress") send({ type: "tool-call" });
              else if (event.type === "error") throw new Error(event.message || "The assistant could not finish.");
              else if (event.type === "complete") { if (event.writeProposals?.length) {
                  if (!reviewWrites || event.writeProposals.some((proposal: {kind?:string}) => proposal.kind !== "workspace")) throw new Error("These proposals cannot be reviewed here.");
                  send({type:"write-proposals", proposals:event.writeProposals});
                } send({ type: "final-text", text: event.text });
                if (active === turn && historyPath === params.path) history = [...history, { role: "user" as const, content: prompt }, { role: "assistant" as const, content: String(event.text).slice(0, 12000) }].slice(-8);
                complete = true; }
            }
          }
          if (!complete) throw new Error("The assistant connection ended before completion.");
          send({ type: "turn-completed" });
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) {
        if (!turn.controller.signal.aborted) send({ type: "error", message: error instanceof Error ? error.message : "Assistant unavailable." });
      } finally { if (active === turn) active = null; }
      return {};
    },
  };
}
