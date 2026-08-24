import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "TextText agent troubleshooting" };

export default function TroubleshootingPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Troubleshooting</p>
        <h1 className="connect-title">Find the broken step</h1>
        <p className="connect-lede">
          Check context, authentication, and one visible edit in that order.
          Avoid rebuilding a connection that is already working.
        </p>
        <section className="connect-section">
          <h2 className="connect-section-title">
            The agent sees the wrong document
          </h2>
          <p>
            Open the intended item and check the context chip above the
            assistant composer. For an external agent, ask it to name the
            current TextText item before writing. If it names a folder or
            workspace instead, open the item and repeat the request.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">
            TextText Agent is unavailable
          </h2>
          <p>
            App Store and browser builds use an OpenAI or Anthropic API key in
            Workspace Settings. The standalone Mac edition can also use an
            eligible local Codex account. Choose the path shown for your edition
            rather than trying to install a local runtime into the App Store
            build.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">
            Local Claude or Codex cannot reach TextText
          </h2>
          <p>
            Keep the standalone TextText app in Applications and sign in once.
            Then run <code>texttext ls</code>, or run the bundled helper at
            <code>
              {" "}
              /Applications/TextText.app/Contents/Helpers/texttext ls
            </code>
            . Restart Claude or Codex after installing the plugin. This local
            path does not use MCP or a workspace token.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">
            A remote MCP client has no TextText tools
          </h2>
          <p>
            Confirm the client supports a person-supplied bearer credential and
            that its token has not been revoked at{" "}
            <Link href="/connect">Connect</Link>. Check the client&apos;s MCP
            status for the hosted TextText connection. If the client only
            supports OAuth, it cannot use TextText&apos;s current endpoint.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">A write was rejected</h2>
          <p>
            The document may have changed after the agent read it. Ask the agent
            to read the latest version, merge only the intended edit, and retry.
            A cloud proposal may also have expired or already been decided. Ask
            for a new proposal rather than retrying the old approval. Publishing,
            access changes, and destructive actions stay in TextText&apos;s own
            guarded controls.
          </p>
          <p>
            If TextText says an external call may have completed, check the
            external app before doing anything else. That state means the
            server returned a result but TextText could not confirm its audit
            or receipt. The old proposal is terminal and cannot be run again.
          </p>
          <p>
            The same rule applies when a workspace change completed but its
            receipt could not be saved. Verify the document before asking for
            another change. If another device already completed or denied a
            proposal, TextText returns that durable result instead of replacing
            it with a generic error.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">
            The connection works, but the result is poor
          </h2>
          <p>
            Narrow the request to one document and one outcome. Name what must
            not change. Ask for a visible edit before asking the agent to
            reorganize a folder or publish anything. The{" "}
            <Link href="/docs/getting-started">first capture guide</Link>
            provides a known-good capture, search, and guarded rewrite loop.
          </p>
        </section>
      </main>
    </div>
  );
}
