import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "TextText documentation",
  description: "Set up AI, understand the TextText agent, and troubleshoot connections.",
};

const guides = [
  ["Features", "What TextText does today, feature by feature, as verified in a running build.", "/docs/features"],
  ["Build item types", "Describe fields, item pages, and folder layouts, then save them as one reusable type.", "/docs/item-types"],
  ["Getting started", "Connect an agent and send your first safe workspace request.", "/docs/getting-started"],
  ["How AI works", "Understand native ChatGPT/Codex, API keys, MCP, tools, and billing.", "/docs/how-it-works"],
  ["AI and agent guide", "Complete provider setup, workflows, and verification.", "/docs/ai"],
  ["MCP reference", "Every tool, per-client setup, and connecting other MCP servers to your assistant.", "/docs/mcp"],
  ["Security and privacy", "Learn what stays local, what crosses the network, and how access is revoked.", "/docs/security"],
  ["Troubleshooting", "Diagnose runtime, sign-in, tool, rate-limit, and conflict failures.", "/docs/troubleshooting"],
] as const;

export default function DocsIndexPage() {
  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">TextText documentation</p>
        <h1 className="connect-title">Use AI with TextText</h1>
        <p className="connect-lede">
          Start with the shortest path, then learn how the native agent, MCP
          connections, workspace tools, approvals, and billing fit together.
        </p>
        <section className="connect-integration-grid" aria-label="Documentation guides">
          {guides.map(([title, description, href]) => (
            <Link className="connect-integration-card" href={href} key={href}>
              <p className="connect-provider-kicker">Guide</p>
              <h2>{title}</h2>
              <p className="connect-integration-description">{description}</p>
              <span aria-hidden="true">Read guide →</span>
            </Link>
          ))}
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">Choose your path</h2>
          <ul className="connect-feature-list">
            <li><Link href="/docs/item-types">I want to build a publication, project board, or notes system.</Link></li>
            <li><Link href="/docs/getting-started">I want AI inside the Mac app.</Link></li>
            <li><Link href="/docs/ai#chatgpt-external">I want ChatGPT, Claude, or Codex to use TextText.</Link></li>
            <li><Link href="/docs/mcp#tools">I am writing an agent and need the tool reference.</Link></li>
            <li><Link href="/docs/mcp#outbound">I want my assistant to use another app&apos;s MCP tools.</Link></li>
            <li><Link href="/docs/how-it-works#billing">I want to understand subscriptions versus API billing.</Link></li>
            <li><Link href="/docs/troubleshooting">Something is not connecting or responding.</Link></li>
          </ul>
        </section>
      </main>
    </div>
  );
}
