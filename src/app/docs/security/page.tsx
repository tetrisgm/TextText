import type { Metadata } from "next";
import "@/styles/connect.css";

export const metadata: Metadata = { title: "TextText AI security and privacy" };

export default function SecurityPage() {
  return <div className="applecms connect-shell"><main className="connect-main connect-doc">
    <p className="connect-provider-kicker">Security and privacy</p><h1 className="connect-title">What crosses the boundary</h1>
    <p className="connect-lede">Choose the connection that matches your privacy and control needs. The provider still receives the context required to answer your request.</p>
    <section className="connect-section"><h2 className="connect-section-title">Native Mac connection</h2><p className="connect-body">The app keeps the JSON-RPC bridge private to its own web view and filters provider API-key environment variables before starting the runtime. The provider can receive the prompt and workspace context needed for the turn. TextText does not display or store the provider credential.</p></section>
    <section className="connect-section"><h2 className="connect-section-title">Hosted MCP connection</h2><p className="connect-body">The client receives only the scopes and workspace access granted through OAuth or a revocable token. Requests are authenticated, audited, and checked against workspace visibility. Revoke a client from Connect.</p></section>
    <section className="connect-section"><h2 className="connect-section-title">Your controls</h2><ul className="connect-feature-list"><li>Use read-only access when a client only needs retrieval.</li><li>Review confirmations before writes, publishing, access changes, or deletion.</li><li>Sign out or revoke a connection when a device or client is no longer trusted.</li><li>Never paste API keys into prompts, documents, screenshots, or support messages.</li></ul></section>
  </main></div>;
}
