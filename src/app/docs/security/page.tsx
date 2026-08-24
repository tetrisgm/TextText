import type { Metadata } from "next";
import "@/styles/connect.css";

export const metadata: Metadata = { title: "TextText AI security and privacy" };

export default function SecurityPage() {
  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Security and privacy</p>
        <h1 className="connect-title">What crosses the boundary</h1>
        <p className="connect-lede">
          Choose the connection that matches your privacy and control needs. The
          provider still receives the context required to answer your request.
        </p>
        <section className="connect-section">
          <h2 className="connect-section-title">Native Mac connection</h2>
          <p className="connect-body">
            The app keeps the JSON-RPC bridge private to its own web view and
            filters provider API-key environment variables before starting the
            runtime. The provider can receive the prompt and workspace context
            needed for the turn. TextText does not display or store the provider
            credential.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">Hosted MCP connection</h2>
          <p className="connect-body">
            The client receives only the scopes and workspace access granted by
            the revocable token it was given. Requests are authenticated,
            audited, and checked against workspace visibility. Revoke a client
            from Connect.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">Your controls</h2>
          <ul className="connect-feature-list">
            <li>
              Give each remote client its own clearly named workspace token.
            </li>
            <li>
              Review the exact fields of selection and freeform cloud write
              proposals before Apply. A proposal is owner-bound, expires, and
              can execute only once. Publishing, access, and Trash stay outside
              this cloud proposal surface.
            </li>
            <li>
              Every connected MCP server call waits for a proposal that names
              the server, tool, and exact arguments. Server descriptions and
              read-only labels are untrusted claims. If the reviewed tool
              definition, endpoint, or protected connection configuration
              changes, approval fails closed. Enabled servers not named in your
              request are not contacted.
            </li>
            <li>
              Local MCP execution is disabled in the standalone app until it
              can use the same durable review. Local agents use the signed-in
              TextText CLI, not a localhost server.
            </li>
            <li>
              Sign out or revoke a connection when a device or client is no
              longer trusted.
            </li>
            <li>
              Never paste API keys into prompts, documents, screenshots, or
              support messages.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
