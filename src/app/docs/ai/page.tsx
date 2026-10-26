import type { Metadata } from "next";
import Link from "next/link";
import {
  AGENT_INTEGRATIONS,
  TEXTTEXT_HOSTED_MCP_URL,
} from "@/lib/agent-integrations";

const LOCAL_AGENT_INTEGRATIONS = AGENT_INTEGRATIONS.filter(
  (integration) => integration.id !== "mcp",
);

export const metadata: Metadata = {
  title: "Connect an agent to TextText",
  description: "Use TextPack files, the local CLI, or hosted MCP with TextText.",
};

export default function AiDocsPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Connect</p>
        <h1 className="connect-title">Work with an agent</h1>
        <p className="connect-lede">
          Keep the conversation in the agent you already use. TextText keeps the
          document, its access rules, and its recovery history.
        </p>

        <section className="connect-section" id="files">
          <h2 className="connect-section-title">Edit local files directly</h2>
          <p>
            An agent with access to your workspace folder can read and edit
            TextPack files using ordinary file tools. TextText detects external
            changes and joins them to the document when possible. A file edit
            does not identify its author as a verified agent, so review the
            result in TextText. Concurrent changes that cannot merge stay
            available for recovery.
          </p>
        </section>

        <section className="connect-section" id="local-agent">
          <h2 className="connect-section-title">Use the local CLI</h2>
          <p>
            In the standalone Mac edition, local Claude and Codex integrations
            can use the installed TextText CLI and your signed-in session.
            Local CLI work needs no workspace token or loopback server. You can
            also call the CLI directly for document operations.
          </p>
          <div className="docs-agent-list">
            {LOCAL_AGENT_INTEGRATIONS.map((integration) => (
              <details className="docs-agent" key={integration.id}>
                <summary>
                  <span
                    className={`connect-integration-mark is-${integration.id}`}
                    aria-hidden="true"
                  >
                    {integration.monogram}
                  </span>
                  <span>
                    <strong>{integration.name}</strong>
                    <small>{integration.environment}</small>
                  </span>
                </summary>
                <ol>
                  {integration.steps.map((step) => (
                    <li key={step.text}>
                      {step.text}
                      {step.copy ? (
                        <pre className="connect-code">{step.copy.value}</pre>
                      ) : null}
                    </li>
                  ))}
                </ol>
                <p>{integration.outcome}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="connect-section" id="remote-client">
          <h2 className="connect-section-title">Connect a remote MCP client</h2>
          <p>
            A client that supports bearer-authenticated MCP can use a
            revocable workspace token from <Link href="/connect">Connect</Link>.
            Configure it to call{" "}
            <code className="connect-inline-code">{TEXTTEXT_HOSTED_MCP_URL}</code>
            {" "}with that token as its bearer credential. Revoke the token
            from Connect when it is no longer needed.
          </p>
          <p>
            Hosted commands use the authenticated workspace, validate
            permissions, and record mutations in the audit log. Keep tokens out
            of documents, prompts, repositories, and support messages. See the
            <Link href="/docs/mcp"> MCP reference</Link> for exact commands.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Review a change</h2>
          <p>
            Ask the agent to change one scratch note, then open that note in
            TextText and confirm the exact text. Edit the file or ask for a
            smaller follow-up if it needs correction. Quit TextText normally
            and reopen the note to confirm the saved result.
          </p>
        </section>
      </main>
    </div>
  );
}
