import { useEffect, useRef, useState } from "react";
import { vaultRequest } from "./bridge";

type AgentState = "disconnected" | "connecting" | "signed-out" | "ready" | "working" | "failed";
type Status = { state: AgentState; message?: string; accountEmail?: string };
type Message = { id: number; role: "user" | "assistant"; text: string };
type AgentEvent = Partial<Status> & { type: string; text?: string; tool?: string; path?: string };
const MAX_MESSAGES = 50, MAX_TEXT = 24_000, MAX_TOTAL = 120_000;
function bounded(messages: Message[]): Message[] {
  const kept = messages.slice(-MAX_MESSAGES).map((message) => ({ ...message, text: message.text.slice(0, MAX_TEXT) }));
  let total = kept.reduce((sum, message) => sum + message.text.length, 0);
  while (kept.length > 1 && total > MAX_TOTAL) total -= kept.shift()!.text.length;
  return kept;
}

export function NativeAssistant({ open, path, onClose, beforeSend }: {
  open: boolean; path?: string; onClose: () => void; beforeSend: () => Promise<boolean>;
}) {
  const [status, setStatus] = useState<Status>({ state: "disconnected" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const sequence = useRef(0);
  const replyId = useRef<number | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<AgentEvent>).detail;
      if (!detail) return;
      if (detail.type === "status" && detail.state) setStatus({ state: detail.state, message: detail.message, accountEmail: detail.accountEmail });
      else if ((detail.type === "text-delta" || detail.type === "final-text") && detail.text !== undefined) {
        const id = replyId.current ?? ++sequence.current; replyId.current = id;
        setMessages((previous) => {
          const existing = previous.find((message) => message.id === id);
          const text = detail.type === "final-text" ? detail.text! : (existing?.text ?? "") + detail.text;
          return bounded([...previous.filter((message) => message.id !== id), { id, role: "assistant", text }]);
        });
      } else if (detail.type === "tool-call") setAction(detail.path ? `Working with ${detail.path}` : "Working with your files");
      else if (detail.type === "turn-completed") { setStatus((current) => current.state === "working" ? { ...current, state: "ready" } : current); setAction(""); replyId.current = null; }
      else if (detail.type === "error") { setNotice(detail.message || "The assistant could not finish this request."); setStatus((current) => ({ ...current, state: "failed" })); setAction(""); }
    };
    window.addEventListener("texttext:vault-agent", receive);
    return () => window.removeEventListener("texttext:vault-agent", receive);
  }, []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void vaultRequest<Status>("agentStatus").then((next) => { if (active) setStatus(next); }).catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [open]);
  useEffect(() => { if (open && log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, action, open]);
  const connect = async () => {
    setNotice(""); setStatus({ state: "connecting" });
    try { setStatus(await vaultRequest<Status>("agentConnect")); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not connect Codex."); setStatus({ state: "failed" }); }
  };
  const send = async () => {
    const text = prompt.trim();
    if (!text || submitting || status.state !== "ready") return;
    setSubmitting(true); setNotice("");
    try {
      if (!await beforeSend()) { setNotice("Save or resolve the current item before asking the assistant to edit it."); return; }
      replyId.current = null;
      setMessages((previous) => bounded([...previous, { id: ++sequence.current, role: "user", text }]));
      setPrompt(""); setStatus((current) => ({ ...current, state: "working" }));
      await vaultRequest("agentSend", { prompt: text, ...(path ? { path } : {}) });
    } catch (error) { setNotice(error instanceof Error ? error.message : "The request could not start."); setStatus((current) => ({ ...current, state: "failed" })); }
    finally { setSubmitting(false); }
  };
  if (!open) return null;
  const working = submitting || status.state === "working";
  return <aside className="vault-assistant" aria-label="Assistant">
    <header><h2>Assistant</h2><button aria-label="Close assistant" onClick={onClose}>Close</button></header>
    {status.state !== "ready" && status.state !== "working" && <div className="vault-assistant-connect">
      <p>Work with Codex on the files in this folder.</p>
      <button disabled={status.state === "connecting"} onClick={() => void connect()}>{status.state === "connecting" ? "Connecting…" : "Connect Codex"}</button>
    </div>}
    {(notice || status.message) && <p role="status" className="vault-assistant-notice">{notice || status.message}</p>}
    <div ref={log} className="vault-assistant-messages" aria-live="polite">
      {messages.map((message) => <div className={`vault-assistant-message is-${message.role}`} key={message.id}><strong>{message.role === "user" ? "You" : "Codex"}</strong><p>{message.text}</p></div>)}
      {working && <p className="vault-assistant-action">{action || "Working…"}</p>}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <p className="vault-assistant-context">{path || "Workspace folder"}</p>
      <textarea aria-label="Message assistant" value={prompt} maxLength={12000} rows={4} placeholder="Ask or change these files"
        onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
      {working ? <button type="button" onClick={() => void vaultRequest("agentCancel").catch((error: Error) => setNotice(error.message))}>Stop</button>
        : <button type="submit" disabled={status.state !== "ready" || !prompt.trim()}>Send</button>}
    </form>
  </aside>;
}
