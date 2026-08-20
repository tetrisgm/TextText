import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  AGENT_INTEGRATIONS,
  TEXTTEXT_HOSTED_MCP_URL,
} from "@/lib/agent-integrations";

const LOCAL_AGENT_INTEGRATIONS = AGENT_INTEGRATIONS.filter(
  (integration) => integration.id !== "mcp",
);

export const metadata: Metadata = {
  title: "Connect your AI to TextText",
  description:
    "Use the in-app assistant or connect Claude, Codex, and supported MCP clients.",
};

export default function AiDocsPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Connect</p>
        <h1 className="connect-title">Choose where the conversation lives</h1>
        <p className="connect-lede">
          The document always lives in TextText. Choose whether the conversation
          lives beside it in the TextText sidebar or in the AI app you already
          use.
        </p>
        <section className="connect-section" id="embedded-agent">
          <h2 className="connect-section-title">
            Inside TextText, recommended
          </h2>
          <p>
            Open Workspace Settings, choose AI, and set up the in-app assistant.
            Return to a document and open the right sidebar. The context chip
            names exactly what the agent will read or change.
          </p>
          <p>
            Provider API usage is billed separately. The standalone Mac edition
            may also offer Continue with ChatGPT when an eligible local Codex
            account is available. App Store and browser builds do not launch
            software from your home directory, so they use the API-key or
            external-app paths.
          </p>
          <p>
            <Link href="/connect">Open connection setup</Link>.
          </p>
        </section>
        <section className="connect-section" id="external-agent">
          <h2 className="connect-section-title">
            From your AI app in the standalone Mac edition
          </h2>
          <p>
            Use this path when you want the conversation to stay in Claude or
            Codex. The standalone Mac edition includes a TextText plugin and
            bundled CLI. Install the plugin where available. Local work then
            uses the app&apos;s signed-in session and does not need a workspace
            token.
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
        <details className="docs-advanced" id="remote-client">
          <summary>Connect a remote or manual MCP client</summary>
          <div>
            <p>
              A client that supports bearer-authenticated MCP can use a
              revocable workspace token from{" "}
              <Link href="/connect">Connect</Link>. Configure the client to call{" "}
              <code className="connect-inline-code">
                {TEXTTEXT_HOSTED_MCP_URL}
              </code>{" "}
              with that token as its bearer credential. If the client does not
              offer a bearer-token field, use the API-key in-app assistant. In
              the standalone Mac edition, you can instead use Claude or Codex
              through the local plugin.
            </p>
            <p>
              Revoke the token from Connect at any time. Never paste it into a
              document, prompt, repository, or support message.
            </p>
          </div>
        </details>
        <section className="connect-section">
          <h2 className="connect-section-title">
            Verify the in-app assistant with one selection
          </h2>
          <p>
            Open a scratch note, type the sentence below, select it, and choose
            <strong> Rewrite</strong> from the selection toolbar:
          </p>
          <blockquote className="docs-prompt">
            The machines are important to the work, but they should not get in
            the way of the work.
          </blockquote>
          <p>
            Review the proposed replacement, choose Apply, and confirm the new
            sentence appears in the note. The provider identity stays visible in
            the sidebar and document header. Choose Undo beside this quick
            action result to finish the test. Freeform assistant requests do not
            promise the same proposal step.
          </p>
          <figure className="docs-recipe-proof">
            <Image
              src="/docs/agentic-writing/connection-ready.jpg"
              alt="Mira Chen's TextText workspace showing the ready Chat with Claude sidebar beside AI settings"
              width={1280}
              height={720}
            />
            <figcaption>
              The provider name and ready starters confirm that the in-app
              assistant is connected. The saved key remains write-only.
            </figcaption>
          </figure>
          <h3>Verify the local plugin in the standalone Mac edition</h3>
          <p>
            In Claude or Codex, name the exact TextText path of a scratch note
            and ask for one specific change. Confirm the edit in TextText and
            use a direct edit or a smaller follow-up request if it needs
            correction. The standalone Mac plugin does not use the sidebar
            proposal or context chip.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">What the connection enables</h2>
          <p>
            The API-key in-app assistant can find and create documents, edit and
            organize them, and maintain project records with tools that do not
            require a confirmation gate. The standalone native assistant and
            hosted MCP add guarded comments, publishing, and collaborator
            management. In the standalone Mac edition, the local Claude and
            Codex plugin handles document create, read, update, and append
            unless you connect hosted MCP separately. Start with the copyable
            <Link href="/docs/recipes"> writing recipes</Link>, or use the
            <Link href="/docs/mcp"> MCP reference</Link> for exact commands and
            schemas.
          </p>
        </section>
      </main>
    </div>
  );
}
