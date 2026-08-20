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
          <h2 className="connect-section-title">The agent sees the wrong document</h2>
          <p>
            Open the intended item and check the context chip above the assistant
            composer. For an external agent, ask it to name the current TextText
            item before writing. If it names a folder or workspace instead, open
            the item and repeat the request.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">TextText Agent is unavailable</h2>
          <p>
            App Store and browser builds use an OpenAI or Anthropic API key in
            Workspace Settings. The standalone Mac edition can also use an eligible
            local Codex account. Choose the path shown for your edition rather than
            trying to install a local runtime into the App Store build.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">An external client has no TextText tools</h2>
          <p>
            Restart the client after installing the plugin. Confirm the token is
            set in the environment that launched the client and has not been
            revoked at <Link href="/connect">Connect</Link>. In Claude or Codex,
            open the client&apos;s MCP status and look for TextText.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">A write was rejected</h2>
          <p>
            The document may have changed after the agent read it. Ask the agent
            to read the latest version, merge only the intended edit, and retry.
            Publishing, access changes, and destructive actions may also wait for
            confirmation in TextText.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">The connection works, but the result is poor</h2>
          <p>
            Narrow the request to one document and one outcome. Name what must not
            change. Ask for a visible edit before asking the agent to reorganize a
            folder or publish anything. The{" "}
            <Link href="/docs/getting-started">first-edit guide</Link> provides a
            known-good request.
          </p>
        </section>
      </main>
    </div>
  );
}
