import type { Metadata } from "next";
import "@/styles/connect.css";

export const metadata: Metadata = { title: "How TextText AI works" };

export default function HowItWorksPage() {
  return <div className="applecms connect-shell"><main className="connect-main connect-doc">
    <p className="connect-provider-kicker">Architecture</p><h1 className="connect-title">How AI works in TextText</h1>
    <p className="connect-lede">TextText is the workspace and tool surface. Your chosen AI provider supplies the model. The app never pretends those are the same account.</p>
    <section className="connect-section"><h2 className="connect-section-title">Native Mac agent</h2><p className="connect-body">The Mac app starts a local Codex App Server process and communicates over a private JSON-RPC pipe. The assistant UI receives streamed messages directly. Workspace actions are registered as dynamic tools and execute through TextText’s canonical command surface.</p><p className="connect-body">The app does not run its own MCP endpoint for this path, and it does not stream the conversation through a second visible application.</p></section>
    <section className="connect-section"><h2 className="connect-section-title">External MCP agents</h2><p className="connect-body">Claude, ChatGPT, Codex, and compatible clients connect to TextText’s hosted MCP endpoint. A revocable bearer token authorizes the workspace. The external client owns the conversation; TextText owns documents, permissions, audit records, and conflict checks.</p></section>
    <section className="connect-section" id="billing"><h2 className="connect-section-title">Subscriptions and billing</h2><p className="connect-body">A ChatGPT, Codex, or Claude subscription and an API account are different billing surfaces. The native Codex path uses the account available to the local Codex runtime. Direct API-key mode uses provider API billing. TextText does not convert a consumer subscription into API credits and does not ask for a provider password.</p></section>
    <section className="connect-section"><h2 className="connect-section-title">Safety boundary</h2><ul className="connect-feature-list"><li>Every request is scoped to the current workspace.</li><li>Mutations use the same command and validation layer as the app.</li><li>Destructive and publishing actions can require confirmation.</li><li>Document writes use conflict checks rather than blindly overwriting newer content.</li><li>Notes and bookmarks remain unlisted and access-controlled.</li></ul></section>
  </main></div>;
}
