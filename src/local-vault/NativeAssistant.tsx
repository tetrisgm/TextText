import { agentTaskTitle } from "./agent-task";
import { AssistantWriteProposals, type AssistantWriteProposal } from "./AssistantWriteProposals";
import { AgentPresenceClient } from "./agent-presence-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { vaultRequest, type VaultFile } from "./bridge";
import { galleryAgentImage } from "./gallery-agent-image";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";
import { TemplatePreview } from "./TemplatePreview";
import type { TemplateProposal } from "./template-proposal";
import { useEscapeLayer } from "./LocalKeyboard";
import { agentTaskMatches, readAgentTask, resumeAgentTask, updateAgentTask,
  type AgentTask, type AgentTaskFence } from "./agent-task";
import { connectedAccountLabel } from "./agent-account";

type AgentState = "disconnected" | "connecting" | "signed-out" | "ready" | "working" | "failed";
type Status = { state: AgentState; message?: string; accountEmail?: string; diagnosticId?: string;
  failureCode?: string; recoveryAction?: string };
type Message = { id: number; role: "user" | "assistant"; text: string };
type AgentEvent = Partial<Status> & { proposals?: AssistantWriteProposal[]; type: string; taskId?: string; text?: string; tool?: string; path?: string };
export type NativeAssistantRequest =
  | { type: "agent"; requestId: number; root: string; target: string; suggestedPrompt?: string; imageAssetId?: string }
  | { type: "customize"; requestId: number; taskId: string; root: string; path: string };
type ActiveTurnFence = { type: "agent" | "customize"; taskId: string; root: string; target: string };
const MAX_MESSAGES = 50, MAX_TEXT = 24_000, MAX_TOTAL = 120_000;
function bounded(messages: Message[]): Message[] {
  const kept = messages.slice(-MAX_MESSAGES).map((message) => ({ ...message, text: message.text.slice(0, MAX_TEXT) }));
  let total = kept.reduce((sum, message) => sum + message.text.length, 0);
  while (kept.length > 1 && total > MAX_TOTAL) total -= kept.shift()!.text.length;
  return kept;
}

export function NativeAssistant({ open, path, root, targetTitle, request, onClose, beforeSend, webAssistant = false }: {
  targetTitle?: { path: string; title: string }; webAssistant?: boolean; root: string; open: boolean; path?: string; request: NativeAssistantRequest | null; onClose: () => void; beforeSend: () => Promise<boolean>;
}) {
  useEffect(() => {
    if (webAssistant) void vaultRequest("agentRetarget", { path: path ?? "" }).catch(() => {});
  }, [webAssistant, root, path]);
  const presence = useRef<AgentPresenceClient | null>(null);
  useEffect(() => {
    const client = new AgentPresenceClient(vaultRequest); presence.current = client;
    return () => { client.destroy(); if (presence.current === client) presence.current = null; };
  }, [root]);
  const [writeProposals, setWriteProposals] = useState<{path:string;items:AssistantWriteProposal[]}>({path:"",items:[]});
  const [status, setStatus] = useState<Status>({ state: "disconnected" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState<AgentTask | null>(null);
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTurn, setActiveTurn] = useState<ActiveTurnFence | null>(null);
  const turnActive = activeTurn !== null;
  const taskRef = useRef<AgentTask | null>(null);
  const lastItemTarget = useRef<Pick<AgentTask, "root" | "target"> | null>(null);
  const activeTaskFence = useRef<ActiveTurnFence | null>(null);
  const disconnectRequested = useRef(false);
  const queuedRetarget = useRef(false);
  const handledRequestId = useRef(0);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEscapeLayer(open, "Add agent", onClose);
  const storageKey = `texttext:design-preview:${root}`;
  const [proposal, setProposal] = useState<TemplateProposal | null>(() => {
    try { const text = localStorage.getItem(storageKey); if (!text || text.length > 2_100_000) return null;
      const value = JSON.parse(text); return typeof value.path === "string" && typeof value.hash === "string" && typeof value.templateJSON === "string" ? value : null;
    } catch { return null; }
  });
  const [customizing, setCustomizing] = useState<string | null>(proposal?.path ?? null);
  const [customizationTaskId, setCustomizationTaskId] = useState<string | null>(proposal?.taskId ?? null);
  const customizationTaskIdRef = useRef(customizationTaskId);
  const requested = useRef(proposal?.request ?? "");
  const customizationRoot = useRef(root);
  const target = useRef(customizing);
  useEffect(() => { target.current = customizing; }, [customizing]);
  useEffect(() => { customizationTaskIdRef.current = customizationTaskId; }, [customizationTaskId]);
  const changeProposal = useCallback((value: TemplateProposal | null) => {
    setProposal(value);
    try { if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey); }
    catch { setNotice("This preview could not be saved for recovery. Keep or copy your request before closing."); }
  }, [storageKey]);
  const acceptTask = useCallback((value: AgentTask | null) => {
    if (value) lastItemTarget.current = value;
    taskRef.current = value;
    setTask(value);
  }, []);
  const changeTask = useCallback((fence: AgentTaskFence, change: Partial<Pick<AgentTask, "prompt" | "phase" | "imageAssetId">>) => {
    try {
      const next = updateAgentTask(localStorage, fence, change);
      if (next && agentTaskMatches(taskRef.current, fence)) acceptTask(next);
      return next;
    } catch {
      setNotice("This task could not be saved for recovery. Keep this panel open until the agent starts.");
      return null;
    }
  }, [acceptTask]);
  const agentMode = request?.type === "agent";
  useEffect(() => {
    if (!agentMode) { if (!turnActive) queuedRetarget.current = false; return; }
    if (turnActive) {
      // Keep Stop and incoming events fenced to the running task, then follow the latest selection.
      const fence = activeTaskFence.current;
      queuedRetarget.current = !fence || fence.type !== "agent" || fence.root !== root || fence.target !== path;
      return;
    }
    if (!queuedRetarget.current && open && taskRef.current?.root === root && taskRef.current.target === path) return;
    queuedRetarget.current = false;
    activeTaskFence.current = null;
    void Promise.resolve().then(() => {
      const targetChanged = lastItemTarget.current?.root !== root || lastItemTarget.current.target !== path;
      try {
        const saved = path ? open && agentMode
          ? resumeAgentTask(localStorage, root, path, () => crypto.randomUUID())
          : readAgentTask(localStorage, root, path) : null;
        acceptTask(saved);
        setPrompt(saved?.prompt ?? "");
        if (targetChanged) { setMessages([]); setAction(""); }
        if (saved?.phase === "submitted") setNotice("This task may already have started before TextText closed. It was not sent again. Check the item before sending it again.");
        else if (saved?.phase === "connecting") setNotice("Your task is saved. Continue connecting Codex when you are ready.");
        else setNotice("");
      } catch (error) {
        acceptTask(null); setPrompt("");
        if (targetChanged) { setMessages([]); setAction(""); }
        setNotice(error instanceof Error ? error.message : "Open an item before adding an agent.");
      }
    });
  }, [acceptTask, agentMode, open, path, root, turnActive]);
  useEffect(() => {
    if (!open || !request || turnActive || handledRequestId.current === request.requestId) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      handledRequestId.current = request.requestId;
      if (request.type === "customize") {
        if (request.root !== root || (webAssistant && request.path !== path)) return;
        customizationRoot.current = root;
        activeTaskFence.current = null;
        acceptTask(null); setPrompt(""); setCustomizing(request.path); setCustomizationTaskId(request.taskId); changeProposal(null);
        setNotice(webAssistant ? "Describe the design you want. Applying a design needs approval. New reusable templates are saved first, then applied with a separate approval." : "Describe the change you want. You can preview and refine it before keeping it.");
        requestAnimationFrame(() => composer.current?.focus());
        return;
      }
      const targetPath = path;
      if (!targetPath || request.root !== root || request.target !== targetPath) return;
      try {
        activeTaskFence.current = null;
        let next = resumeAgentTask(localStorage, root, targetPath, () => crypto.randomUUID());
        if (request.imageAssetId && next.prompt && next.imageAssetId !== request.imageAssetId) throw new Error("Your previous task for this item is kept. Finish or clear it before describing another photo.");
        if (request.imageAssetId) next = updateAgentTask(localStorage, next, { imageAssetId: request.imageAssetId, prompt: next.prompt || request.suggestedPrompt || "" }) ?? next;
        acceptTask(next); setCustomizing(null); setCustomizationTaskId(null); setPrompt(next.prompt || request.suggestedPrompt || ""); changeProposal(null);
        setNotice(next.phase === "submitted"
          ? "This task may already have started before TextText closed. It was not sent again. Check the item before sending it again."
          : next.phase === "connecting" ? "Your task is saved. Continue connecting Codex when you are ready." : "");
        requestAnimationFrame(() => composer.current?.focus());
      } catch (error) { setNotice(error instanceof Error ? error.message : "Open an item before adding an agent."); }
    });
    return () => { active = false; };
  }, [acceptTask, changeProposal, open, path, request, root, turnActive, webAssistant]);
  useEffect(() => {
    if (!webAssistant || !customizing || customizing === path && customizationRoot.current === root) return;
    const handled = handledRequestId.current;
    let active = true;
    const taskId = activeTaskFence.current?.taskId;
    activeTaskFence.current = null;
    if (taskId) void vaultRequest("agentCancel", { taskId }).catch(() => {});
    void Promise.resolve().then(() => {
      if (!active || handledRequestId.current !== handled) return;
      setCustomizing(null); setCustomizationTaskId(null); setActiveTurn(null); setPrompt(""); setMessages([]);
      setNotice("Open Customize on this item to start a new design request.");
      setStatus(current => current.state === "working" ? { ...current, state: "ready" } : current);
    });
    return () => { active = false; };
  }, [webAssistant, customizing, path, root]);
  const sequence = useRef(0);
  const replyId = useRef<number | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<AgentEvent>).detail;
      if (!detail) return;
      const turnFence = activeTaskFence.current;
      if (detail.type !== "status" && (!turnFence || detail.taskId !== turnFence.taskId ||
          (turnFence.type === "agent" ? !agentTaskMatches(taskRef.current, turnFence) :
            target.current !== turnFence.target || customizationTaskIdRef.current !== turnFence.taskId))) return;
      if (detail.type === "write-proposals" && webAssistant && turnFence && Array.isArray(detail.proposals)) {
        setWriteProposals({path:turnFence.target,items:detail.proposals.slice(0,12)});
      }
      else if (detail.type === "template-proposal") {
        const proposed = detail as unknown as TemplateProposal & { proposalId?: string };
        let valid = false, message = "";
        try {
          if (typeof proposed.path !== "string" || typeof proposed.hash !== "string" || typeof proposed.templateJSON !== "string" || (target.current && target.current !== proposed.path)) throw new Error("Proposal target must match the selected file.");
          if (proposed.templateJSON.length > 1_000_000 || (proposed.templateAuthoringSourceJSON?.length ?? 0) > 1_000_000) throw new Error("Proposal exceeds the 1 MB design limit.");
          const template = validateTemplateDefinition(JSON.parse(proposed.templateJSON));
          validatedLookSource(template, proposed.templateAuthoringSourceJSON ? JSON.parse(proposed.templateAuthoringSourceJSON) : undefined);
          setNotice(""); changeProposal({ ...proposed, taskId: turnFence!.taskId, request: requested.current }); setCustomizing(proposed.path); valid = true;
        } catch (error) {
          message = error instanceof Error ? error.message.slice(0, 6000) : "Invalid template definition.";
          setNotice("The proposed design needs a correction. The assistant is receiving the validation details; your file is unchanged.");
        }
        if (proposed.proposalId) void vaultRequest("agentProposalResult", { taskId: turnFence!.taskId, proposalId: proposed.proposalId, valid, message }).catch((error: Error) => setNotice(error.message));
      }
      else if (detail.type === "status" && detail.state) {
        setStatus({ state: detail.state, message: detail.message, accountEmail: detail.accountEmail,
          diagnosticId: detail.diagnosticId, failureCode: detail.failureCode, recoveryAction: detail.recoveryAction });
        if (detail.state === "disconnected" && disconnectRequested.current) {
          disconnectRequested.current = false;
          setNotice("Codex disconnected. Your task is still here.");
        }
        const current = taskRef.current;
        if (current?.phase === "connecting" && detail.state === "ready") changeTask(current, { phase: "draft" });
      }
      else if ((detail.type === "text-delta" || detail.type === "final-text") && detail.text !== undefined) {
        const id = replyId.current ?? ++sequence.current; replyId.current = id;
        setMessages((previous) => {
          const existing = previous.find((message) => message.id === id);
          const text = detail.type === "final-text" ? detail.text! : (existing?.text ?? "") + detail.text;
          return bounded([...previous.filter((message) => message.id !== id), { id, role: "assistant", text }]);
        });
      } else if (detail.type === "tool-call") setAction(detail.path ? `Working with ${detail.path}` : "Working with this item");
      else if (detail.type === "turn-completed") {
        if (turnFence && agentTaskMatches(taskRef.current, turnFence)) { changeTask(turnFence, { prompt: "", phase: "draft" }); setPrompt(""); }
        activeTaskFence.current = null; setActiveTurn(null);
        setStatus((current) => current.state === "working" ? { ...current, state: "ready" } : current); setAction(""); replyId.current = null;
      }
      else if (detail.type === "turn-cancelled") {
        if (turnFence && agentTaskMatches(taskRef.current, turnFence)) {
          const preserved = taskRef.current?.prompt ?? "";
          changeTask(turnFence, { phase: "draft" }); setPrompt(preserved);
        } else setPrompt(requested.current);
        activeTaskFence.current = null; setActiveTurn(null);
        setNotice(detail.message || "Stopped. Your task is ready to send again.");
        setStatus((current) => ({ ...current, state: "ready" })); setAction(""); replyId.current = null;
      }
      else if (detail.type === "error") {
        if (turnFence && agentTaskMatches(taskRef.current, turnFence)) { changeTask(turnFence, { phase: "draft" }); setPrompt(taskRef.current?.prompt ?? ""); }
        else setPrompt(requested.current);
        activeTaskFence.current = null; setActiveTurn(null);
        setNotice(detail.message || "The assistant could not finish this request.");
        setStatus((current) => ({ ...current, state: "failed", diagnosticId: detail.diagnosticId,
          failureCode: detail.failureCode, recoveryAction: detail.recoveryAction })); setAction("");
      }
    };
    window.addEventListener("texttext:vault-agent", receive);
    return () => window.removeEventListener("texttext:vault-agent", receive);
  }, [changeProposal, changeTask, webAssistant]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = () => {
      if (activeTaskFence.current) return;
      void vaultRequest<Status>("agentStatus").then((next) => {
      if (!active) return;
      setStatus(next);
      const current = taskRef.current;
      if (current?.phase === "connecting" && next.state === "ready") changeTask(current, { phase: "draft" });
    }).catch((error: Error) => { if (active) setNotice(error.message); });
    };
    refresh();
    if (webAssistant) window.addEventListener("texttext:ai-settings-changed", refresh);
    return () => { active = false; window.removeEventListener("texttext:ai-settings-changed", refresh); };
  }, [changeTask, open, webAssistant]);
  useEffect(() => { if (open && log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, action, open]);
  const connect = async () => {
    const currentTask = taskRef.current;
    const fence: AgentTaskFence | null = currentTask && currentTask.root === root && currentTask.target === path ? currentTask : null;
    if (!fence && !customizing) { setNotice("Open an item and add the agent from that item."); return; }
    if (fence) changeTask(fence, { phase: "connecting" });
    setNotice(""); setStatus({ state: "connecting" });
    try {
      const next = await vaultRequest<Status>("agentConnect");
      if (fence && !agentTaskMatches(taskRef.current, fence)) return;
      setStatus(next);
      if (fence && next.state === "ready") changeTask(fence, { phase: "draft" });
    }
    catch (error) {
      if (fence && !agentTaskMatches(taskRef.current, fence)) return;
      if (fence) changeTask(fence, { phase: "draft" });
      setNotice(error instanceof Error ? error.message : "Could not connect Codex."); setStatus({ state: "failed" });
    }
  };
  const send = async () => {
    const text = prompt.trim();
    if (!text || submitting || status.state !== "ready") return;
    const currentTask = taskRef.current;
    const taskFence = currentTask && currentTask.root === root && currentTask.target === path ? currentTask : null;
    if (!customizing && !taskFence) { setNotice("Add the agent from the open item before starting a task."); return; }
    const turnFence: ActiveTurnFence | null = taskFence
      ? { type: "agent", taskId: taskFence.taskId, root: taskFence.root, target: taskFence.target }
      : customizing && customizationTaskId
        ? { type: "customize", taskId: customizationTaskId, root, target: customizing }
        : null;
    if (!turnFence) { setNotice("Open this design again before sending the request."); return; }
    setSubmitting(true); setNotice("");
    try {
      if (taskFence) changeTask(taskFence, { prompt: text, phase: "submitted" });
      activeTaskFence.current = turnFence; setActiveTurn(turnFence);
      if (!await beforeSend()) {
        if (taskFence) changeTask(taskFence, { phase: "draft" });
        activeTaskFence.current = null; setActiveTurn(null);
        setNotice("Save or resolve the current item before asking the assistant to edit it."); return;
      }
      const selectedPath = customizing ?? taskFence?.target;
      const imageAssetId = taskFence?.imageAssetId;
      const image = !webAssistant && imageAssetId && selectedPath
        ? await galleryAgentImage(await vaultRequest<VaultFile>("read", { path: selectedPath }), imageAssetId)
        : undefined;
      // File reads and image decoding may outlive a close or target change.
      if (activeTaskFence.current?.taskId !== turnFence.taskId ||
          taskFence && !agentTaskMatches(taskRef.current, taskFence)) return;
      replyId.current = null;
      setMessages((previous) => bounded([...previous, { id: ++sequence.current, role: "user", text }]));
      setPrompt(""); setStatus((current) => ({ ...current, state: "working" }));
      requested.current = text;
      const refinement = proposal ? `\n\nRefine this pending design for the same file. It has not been saved. Baseline hash: ${proposal.hash}\nPending templateJSON: ${proposal.templateJSON}\nPending templateAuthoringSourceJSON: ${proposal.templateAuthoringSourceJSON ?? "none"}` : "";
      if (selectedPath && !webAssistant) void presence.current?.start(selectedPath, turnFence.taskId);
      await vaultRequest("agentSend", { prompt: text + refinement, scope: "item", customizing: !!customizing,
        ...(imageAssetId ? { imageAssetId } : {}), ...(image ? { imageUrl: image.dataUrl } : {}),
        taskId: turnFence.taskId, ...(selectedPath ? { path: selectedPath } : {}) });
    } catch (error) {
      presence.current?.stop();
      if (taskFence && agentTaskMatches(taskRef.current, taskFence)) changeTask(taskFence, { prompt: text, phase: "draft" });
      if (activeTaskFence.current?.taskId === turnFence.taskId) activeTaskFence.current = null;
      setActiveTurn(null);
      setPrompt(text); setNotice(error instanceof Error ? error.message : "The request could not start."); setStatus((current) => ({ ...current, state: "failed" }));
    }
    finally { setSubmitting(false); }
  };
  const disconnect = async () => {
    if (submitting || status.state !== "ready") return;
    disconnectRequested.current = true;
    setNotice("Disconnecting Codex. Your task stays here.");
    try {
      const next = await vaultRequest<Status>("agentDisconnect");
      setStatus(next);
      if (next.state === "disconnected") {
        disconnectRequested.current = false;
        setNotice("Codex disconnected. Your task is still here.");
      }
    } catch (error) {
      disconnectRequested.current = false;
      setNotice(error instanceof Error ? error.message : "Codex could not disconnect.");
    }
  };
  const cancel = async () => {
    const fence = activeTaskFence.current;
    await vaultRequest("agentCancel", { scope: "item", ...(fence ? { taskId: fence.taskId } : { customizing: true }) });
  };
  if (!open) return null;
  const working = submitting || status.state === "working";
  const runningFence = activeTurn?.type === "agent" ? activeTurn : null;
  const itemTask = task && task.root === root && (task.target === path || (runningFence && agentTaskMatches(task, runningFence))) ? task : null;
  const accountLabel = connectedAccountLabel(status.accountEmail)
    ?? (status.state === "ready" || status.state === "working" ? "Codex connected" : null);
  const diagnosticReference = status.state === "failed" && status.diagnosticId && /^[A-Z0-9-]{4,64}$/.test(status.diagnosticId)
    ? status.diagnosticId : null;
  const heading = customizing ? "Customize" : "Add agent";
  return <><aside className={`vault-assistant${proposal ? " has-design-preview" : ""}`} aria-label={heading}>
    <header><h2>{heading}</h2><button aria-label="Close assistant" onClick={onClose}>Close</button></header>
    {itemTask && <div className="vault-assistant-setup" role="group" aria-label="Agent task target">
      <strong>{agentTaskTitle(itemTask.target, targetTitle)}</strong>
      <p>{webAssistant ? "This item · Changes need approval" : "This item · Read and edit"}</p>
      <small>{itemTask.target}</small>
    </div>}
    {accountLabel && !webAssistant && <div className="vault-assistant-account" role="group" aria-label="Codex account">
      <span>{accountLabel}</span>
      <button type="button" disabled={working || status.state !== "ready"} onClick={() => void disconnect()}>Disconnect</button>
    </div>}
    {status.state !== "ready" && status.state !== "working" && <div className="vault-assistant-connect">
      <p hidden={webAssistant}>Codex uses your ChatGPT account. Authorization opens in your browser. Your request stays here while you sign in. You won’t need to paste a token or use Terminal.</p>
      {webAssistant && <button type="button" onClick={() => window.dispatchEvent(new Event("texttext:open-ai-settings"))}>Set up AI in Settings</button>}
      <button hidden={webAssistant} disabled={status.state === "connecting"} onClick={() => void connect()}>{status.state === "connecting" ? "Connecting…" : "Connect Codex"}</button>
    </div>}
    {(notice || status.message) && <p role="status" className="vault-assistant-notice">{notice || status.message}
      {diagnosticReference && <><br /><small>Diagnostic reference: {diagnosticReference}</small></>}
    </p>}
    <div ref={log} className="vault-assistant-messages" aria-live="polite">
      {messages.map((message) => <div className={`vault-assistant-message is-${message.role}`} key={message.id}><strong>{message.role === "user" ? "You" : webAssistant ? "Assistant" : "Codex"}</strong><p>{message.text}</p></div>)}
      {working && <p className="vault-assistant-action">{action || "Working…"}</p>}
    </div>
    {webAssistant && path && <AssistantWriteProposals key={`${root}:${path}`} root={root} path={path} proposals={writeProposals.path === path ? writeProposals.items : []} beforeApprove={beforeSend} />}
    {(itemTask || customizing) && <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <p className="vault-assistant-context">{customizing ? `Customize ${customizing}` : webAssistant ? "This item · Changes need approval" : "This item · Read and edit"}</p>
      <label><span>{customizing ? "Design request" : "Task"}</span><textarea ref={composer} aria-label="Message assistant" value={prompt} maxLength={12000} rows={4}
        placeholder={customizing ? "Describe how this item should look" : "What should the agent do?"}
        onChange={(event) => {
          const value = event.target.value; setPrompt(value);
          const current = taskRef.current;
          if (current && current.root === root && current.target === path) {
            changeTask(current, { prompt: value, ...(current.phase === "submitted" ? { phase: "draft" as const } : {}) });
            if (current.phase === "submitted") setNotice("");
          }
        }} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} /></label>
      {working ? <button type="button" onClick={() => void cancel().catch((error: Error) => setNotice(error.message))}>Stop</button>
        : <button type="submit" disabled={status.state !== "ready" || !prompt.trim()}>{customizing ? "Send" : itemTask?.phase === "submitted" ? "Send again" : messages.length ? "Send" : "Start task"}</button>}
    </form>}
  </aside>
    {proposal && <TemplatePreview key={proposal.templateJSON + proposal.hash} proposal={proposal} working={working} beforeKeep={beforeSend}
      onKeep={() => { changeProposal(null); setCustomizing(null); setNotice("Design saved to the file. You can keep editing it normally."); }}
      onCancel={() => { changeProposal(null); setCustomizing(null); setNotice("Preview cancelled. The file is unchanged."); }} />}
  </>;
}
