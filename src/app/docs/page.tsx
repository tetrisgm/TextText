import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "TextText documentation",
  description: "Write with an agent, connect your AI, and keep control of every change.",
};

const nextSteps = [
  {
    number: "01",
    title: "Write with an agent",
    description: "Open one document, give the agent a concrete writing task, then review or undo the change.",
    href: "/docs/getting-started",
    label: "Start the two-minute guide",
  },
  {
    number: "02",
    title: "Connect the AI you use",
    description: "Use TextText Agent inside the app, or connect Claude, Codex, ChatGPT, and other MCP clients.",
    href: "/docs/ai",
    label: "Choose a connection",
  },
  {
    number: "03",
    title: "Learn the working model",
    description: "The open document is the canvas. Context, proposed changes, collaborators, and Undo stay visible there.",
    href: "/docs/how-it-works",
    label: "See how it works",
  },
] as const;

export default function DocsIndexPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">TextText documentation</p>
        <h1 className="connect-title">Write with agents. Keep the document.</h1>
        <p className="connect-lede">
          TextText is a shared writing surface for you, other people, and the AI
          you already use. Start with one visible edit. Learn the connection
          details only when you need them.
        </p>
        <div className="docs-start-path" aria-label="Start here">
          {nextSteps.map((step) => (
            <article className="docs-start-step" key={step.number}>
              <span>{step.number}</span>
              <div>
                <h2>{step.title}</h2>
                <p>{step.description}</p>
                <Link href={step.href}>{step.label} →</Link>
              </div>
            </article>
          ))}
        </div>
        <section className="connect-section">
          <h2 className="connect-section-title">Reference</h2>
          <p className="connect-body">
            Browse <Link href="/docs/features">verified features</Link>, build a
            reusable <Link href="/docs/item-types">item type</Link>, inspect the
            full <Link href="/docs/mcp">MCP reference</Link>, or review
            <Link href="/docs/security"> security and privacy</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
