import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "TextText documentation",
  description:
    "Write with an agent, connect your AI, and keep control of every change.",
};

const nextSteps = [
  {
    number: "01",
    title: "Write with the in-app agent",
    description:
      "Select one sentence, choose Rewrite, then review, apply, or undo the proposed replacement.",
    href: "/docs/getting-started",
    label: "Start the two-minute guide",
  },
  {
    number: "02",
    title: "Connect the AI you use",
    description:
      "Use the assistant inside TextText. In the standalone Mac edition, you can also connect the local TextText plugin to Claude or Codex.",
    href: "/docs/ai",
    label: "Choose a connection",
  },
  {
    number: "03",
    title: "Learn the working model",
    description:
      "The open document is the canvas. Context and collaborator identity stay visible, while selection quick actions add proposal and Undo controls.",
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
            Try <Link href="/docs/recipes">writing recipes</Link>, browse
            <Link href="/docs/features"> verified features</Link>, build a
            reusable <Link href="/docs/item-types">item type</Link>, inspect the
            full <Link href="/docs/mcp">MCP reference</Link>, or review
            <Link href="/docs/security"> security and privacy</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
