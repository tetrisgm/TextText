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
            With a configured provider, the assistant accepts bounded text,
            Markdown, CSV, JSON, YAML, XML, HTML, PDF, Word, Excel, PowerPoint,
            and image attachments over HTTPS. Office files are reduced to
            useful text, tables, cells, formulas, slides, and notes before the
            turn. PDF and image files stay as provider file parts. Unsupported
            or unsafe archives fail with a recovery message.
          </p>
          <p>
            Model selection starts on Auto. TextText uses the provider&apos;s
            faster model for a short answer and its stronger model for files,
            workspace work, editing, and synthesis. Choose an exact model in
            the assistant header whenever you need a reproducible turn. The
            completed answer names the model that actually ran.
          </p>
          <p>
            Each workspace context keeps a bounded, owner-only chat history.
            Start another chat, reopen an earlier one, search by title or
            message text, and pin the conversations you return to. TextText
            keeps a local copy for offline use and synchronizes it across the
            owner&apos;s signed-in devices. Common credential fields and
            recognizable token-shaped text are removed before synchronization.
          </p>
          <p>
            <Link href="/connect">Open connection setup</Link>.
          </p>
          <p>
            Workspace Settings has a Connections overview. It lists the
            configured provider, active AI client tokens, outbound MCP
            servers, and sign-in methods, with each row linking to its control.
            Revoke a hosted client token, remove an outbound MCP server, or
            remove a workspace provider key there. On the standalone Mac,
            Disconnect stops TextText using the native Codex session without
            signing you out of Codex in other apps.
          </p>
          <p>
            TextText contacts a connected external MCP server for tool discovery
            only when you include its exact Settings shortcut, such as
            <code className="connect-inline-code">@mcp:paper</code>, in the
            request. A bare name or ordinary prose never contacts it. No
            discovered tool runs during answer generation. Every tool, including one the
            server labels read-only, waits for your review of the exact
            arguments. TextText also freezes
            the reviewed tool definition and refuses approval if a same-name
            tool, destination endpoint, or protected connection configuration
            changes before execution. Unrelated turns do not discover or
            contact the connection. Local MCP execution
            stays disabled; agents on this Mac use the signed-in TextText CLI
            instead.
          </p>
          <p>
            Agent instructions in Workspace Settings hold durable guidance for
            the in-app assistant. Standing instructions apply to every turn. A
            reusable skill applies only when the request names its shortcut,
            such as <code className="connect-inline-code">/weekly-review</code>.
            Type <code className="connect-inline-code">/</code> in the assistant
            to find and insert a saved shortcut. Notes and retrieved text remain
            reference material, not assistant instructions.
          </p>
          <p>
            For high-level recent-work questions, the assistant can answer from
            a bounded, access-checked index, and those receipts are marked Found.
            When a request needs document detail, it reads the exact relevant
            documents and marks their receipts Read. An index or search snippet
            is never presented as a read source.
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
          <summary>Connect a remote MCP client</summary>
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
            action result to finish the test. Freeform requests stream their
            answer and tool progress, and you can save a useful answer directly
            to Notes or rate it with thumbs up or down.
          </p>
          <p>
            Freeform document writes use the same review rule. The model can
            prepare a validated change, but the change remains inert until the
            workspace owner reviews the exact fields and chooses Apply change.
            Dismiss, expiry, replay, or an account mismatch cannot execute it.
            Publishing, access, Trash, restore, and model-chosen network work
            stay outside this cloud proposal surface.
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
            The API-key in-app assistant can search and read workspace sources,
            create documents, prepare edits and organization changes for
            review, and maintain project records. The standalone native
            assistant and hosted MCP add guarded comments, publishing, and
            collaborator management. In the standalone Mac edition, the local
            Claude and Codex plugin handles document create, read, update, and
            append unless you connect hosted MCP separately. Start with the copyable
            <Link href="/docs/recipes"> writing recipes</Link>, or use the
            <Link href="/docs/mcp"> MCP reference</Link> for exact commands and
            schemas.
          </p>
        </section>
      </main>
    </div>
  );
}
