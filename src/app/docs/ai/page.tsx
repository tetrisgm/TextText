import type { Metadata } from "next";
import Link from "next/link";
import {
  AGENT_INTEGRATIONS,
  TEXTTEXT_HOSTED_MCP_URL,
  TEXTTEXT_TOKEN_PROMPT_COMMAND,
} from "@/lib/agent-integrations";

export const metadata: Metadata = {
  title: "Connect your AI to TextText",
  description: "Use TextText Agent or connect Claude, Codex, ChatGPT, and other MCP clients.",
};

export default function AiDocsPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Connect</p>
        <h1 className="connect-title">Choose where the conversation lives</h1>
        <p className="connect-lede">
          The document always lives in TextText. Choose whether the conversation
          lives beside it in the TextText sidebar or in the AI app you already use.
        </p>
        <section className="connect-section" id="embedded-agent">
          <h2 className="connect-section-title">TextText Agent</h2>
          <p>
            Best when you want to stay inside TextText. Open Workspace Settings,
            choose AI, add an OpenAI or Anthropic API key, then return to the
            document and open the right sidebar.
          </p>
          <p>
            Provider API usage is billed separately. The standalone Mac edition
            may also offer Continue with ChatGPT when an eligible local Codex
            account is available. App Store and browser builds do not launch
            software from your home directory, so they use the API-key or
            external-app paths.
          </p>
          <p><Link href="/connect">Open connection setup</Link>.</p>
        </section>
        <section className="connect-section" id="external-agent">
          <h2 className="connect-section-title">Your AI app</h2>
          <p>
            Best when you already work in Claude, Codex, ChatGPT, or another MCP
            client. Create one workspace token at Connect, install the recommended
            plugin where available, and start the AI from the same Terminal session.
          </p>
          <div className="docs-agent-list">
            {AGENT_INTEGRATIONS.map((integration) => (
              <details
                className="docs-agent"
                key={integration.id}
                id={integration.id === "chatgpt" ? "chatgpt-external" : undefined}
              >
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
                      {step.copy ? <pre className="connect-code">{step.copy.value}</pre> : null}
                    </li>
                  ))}
                </ol>
                <p>{integration.outcome}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="connect-section" id="api-key">
          <h2 className="connect-section-title">A secure token handoff</h2>
          <p>
            Claude and Codex plugin installers do not collect generic bearer
            tokens. Create the token at <Link href="/connect">Connect</Link>, then
            use this hidden prompt before starting the client from the same Terminal:
          </p>
          <pre className="connect-code">{TEXTTEXT_TOKEN_PROMPT_COMMAND}</pre>
          <p>
            Manual clients use{" "}
            <code className="connect-inline-code">{TEXTTEXT_HOSTED_MCP_URL}</code>
            {" "}with the token as a bearer credential. Revoke it from Connect at any time.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">Verify with the document, not a status light</h2>
          <p>Open a scratch note in TextText, then ask your agent:</p>
          <blockquote className="docs-prompt">
            In the open TextText note, add a heading called Connection verified
            and one sentence beneath it. Do not change anything else.
          </blockquote>
          <p>
            The result should appear in that note, with the agent identified as
            a collaborator. Undo the change to finish the test.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">What the connection enables</h2>
          <p>
            Agents can find and create documents, edit and organize them, comment,
            publish after confirmation, manage collaborators, and maintain durable
            project records. For exact commands and schemas, use the
            <Link href="/docs/mcp"> MCP reference</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
