"use client";

import { useRef, useState } from "react";
import { CollaboratorMark } from "@/components/collab/CollaboratorMark";
import {
  AGENT_INTEGRATIONS,
  AGENT_WORKFLOWS,
} from "@/lib/agent-integrations";

export function AgentIntegrationHome({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(null), 2000);
  }

  if (compact) {
    return (
      <section
        className="workspace-agent-entry is-compact"
        aria-labelledby="workspace-agent-entry-title"
      >
        <div className="workspace-agent-compact-marks" aria-hidden="true">
          {AGENT_INTEGRATIONS.slice(0, 3).map((integration) => (
            <CollaboratorMark
              key={integration.id}
              provider={integration.id}
              name={integration.name}
            />
          ))}
        </div>
        <div>
          <h2 id="workspace-agent-entry-title">Work with your AI tools</h2>
          <p>
            Connect Claude, Codex, ChatGPT, or another MCP client to this
            workspace.
          </p>
        </div>
        <a href="/connect">Connections</a>
      </section>
    );
  }

  return (
    <section
      className="workspace-agent-entry"
      aria-labelledby="workspace-agent-entry-title"
    >
      <header className="workspace-agent-entry-heading">
        <div>
          <p>AI collaborators</p>
          <h2 id="workspace-agent-entry-title">
            Keep a document open while your agents work in it
          </h2>
          <span>
            Connect the AI tools you already use. Texttext keeps the document
            visible, editable, and current while Claude, Codex, ChatGPT, or
            another MCP client works beside you.
          </span>
        </div>
        <div className="workspace-agent-entry-links">
          <a className="is-primary" href="/connect">
            Manage connections
          </a>
          <a href="/docs/ai">Setup guide</a>
        </div>
      </header>

      <div
        className="workspace-agent-provider-grid"
        aria-label="Connect an AI tool"
      >
        {AGENT_INTEGRATIONS.map((integration) => {
          const actionKey = `integration:${integration.id}`;
          const action = integration.action;
          return (
            <article
              className={`workspace-agent-provider is-${integration.id}`}
              key={integration.id}
            >
              <div className="workspace-agent-provider-heading">
                <span className="workspace-agent-provider-mark">
                  <CollaboratorMark
                    provider={integration.id}
                    name={integration.name}
                  />
                </span>
                <div>
                  <h3>{integration.name}</h3>
                  <p>{integration.environment}</p>
                </div>
              </div>
              <span>{integration.description}</span>
              <div className="workspace-agent-provider-actions">
                {action.kind === "copy" ? (
                  <button
                    type="button"
                    onClick={() => void copy(action.value, actionKey)}
                  >
                    {copied === actionKey
                      ? action.copiedLabel
                      : action.label}
                  </button>
                ) : (
                  <a href={action.href} target="_blank" rel="noreferrer">
                    {action.label}
                  </a>
                )}
                {integration.secondaryAction ? (
                  <a
                    className="is-secondary"
                    href={integration.secondaryAction.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {integration.secondaryAction.label}
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <div className="workspace-agent-live-guide">
        <ol>
          <li>
            <strong>Connect</strong>
            <span>Approve Texttext in your AI tool once.</span>
          </li>
          <li>
            <strong>Open a document</strong>
            <span>Keep the item visible beside your agent.</span>
          </li>
          <li>
            <strong>Work together</strong>
            <span>The named agent appears with its own avatar.</span>
          </li>
          <li>
            <strong>Keep editing</strong>
            <span>Your changes and the agent&apos;s changes converge live.</span>
          </li>
        </ol>
        <div className="workspace-agent-prompt-list">
          {AGENT_WORKFLOWS.slice(0, 2).map((workflow) => {
            const key = `workflow:${workflow.id}`;
            return (
              <button
                type="button"
                key={workflow.id}
                onClick={() => void copy(workflow.prompt, key)}
              >
                <span>
                  <strong>{workflow.title}</strong>
                  <small>{workflow.description}</small>
                </span>
                <b>{copied === key ? "Copied" : "Copy prompt"}</b>
              </button>
            );
          })}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {copied ? "Copied to the clipboard" : ""}
      </p>
    </section>
  );
}
