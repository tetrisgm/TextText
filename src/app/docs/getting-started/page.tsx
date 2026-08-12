import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/connect.css";

export const metadata: Metadata = { title: "Getting started with TextText AI" };

export default function GettingStartedPage() {
  return (
    <div className="applecms connect-shell"><main className="connect-main connect-doc">
      <p className="connect-provider-kicker">Getting started</p>
      <h1 className="connect-title">Your first AI request</h1>
      <p className="connect-lede">The fastest path is to connect one provider, verify read access, then try a reversible draft request.</p>
      <section className="connect-section"><h2 className="connect-section-title">1. Open the AI setup</h2><p className="connect-body">In the Library, use the AI collaborator card. You can also open Workspace Settings and choose AI, or visit <Link href="/connect">Connect</Link>.</p></section>
      <section className="connect-section"><h2 className="connect-section-title">2. Pick a connection</h2><ol className="connect-steps"><li><strong>TextText Agent:</strong> on Mac, connects the app to your existing Codex/ChatGPT account and keeps the conversation inside TextText.</li><li><strong>Another AI app:</strong> connect Claude, ChatGPT, Codex, or another MCP client to TextText.</li><li><strong>API key:</strong> an advanced option billed separately by OpenAI or Anthropic.</li></ol></section>
      <section className="connect-section"><h2 className="connect-section-title">3. Verify before writing</h2><p className="connect-body">Ask <em>“What folders are in my TextText workspace?”</em> A successful answer proves the agent can authenticate and read your workspace. Then ask it to create a draft note titled “AI connection test”.</p></section>
      <section className="connect-section"><h2 className="connect-section-title">4. Keep control</h2><p className="connect-body">Read operations can be automatic. Mutations, publishing, access changes, and destructive actions require confirmation. You can stop using a provider from Settings or revoke an external connection from Connect.</p></section>
      <section className="connect-section"><h2 className="connect-section-title">Next</h2><p className="connect-body"><Link href="/docs/how-it-works">Learn how the architecture and billing work</Link>, or <Link href="/docs/ai">open the complete AI guide</Link>.</p></section>
    </main></div>
  );
}
