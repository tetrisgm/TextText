"use client";

import styles from "./ConnectionGallery.module.css";

export type ConnectionGalleryProps = {
  cloudConfigured: boolean;
  /** Specific state for the TextText AI card ("Anthropic · claude-sonnet-5"). */
  cloudStatusLabel?: string;
  nativeAvailable: boolean;
  nativeReady: boolean;
  clientCount: number | null;
  mcpCount: number | null;
  onVerify?: () => void;
};

/** A small, honest directory of ways an agent can reach this workspace. */
export function ConnectionGallery({
  cloudConfigured,
  cloudStatusLabel,
  nativeAvailable,
  nativeReady,
  clientCount,
  mcpCount,
  onVerify,
}: ConnectionGalleryProps) {
  const cards = [
    {
      name: "TextText AI",
      description: "Use Anthropic or OpenAI with an encrypted workspace key.",
      status: cloudConfigured
        ? (cloudStatusLabel ?? "Connected")
        : "Not connected",
      connected: cloudConfigured,
      href: "#settings-ai",
      action: cloudConfigured ? "Manage" : "Connect",
    },
    ...(nativeAvailable
      ? [
          {
            name: "Codex with ChatGPT",
            description:
              "The standalone Mac agent, embedded in the right sidebar.",
            status: nativeReady ? "Connected" : "Available",
            connected: nativeReady,
            href: "#settings-ai",
            action: nativeReady ? "Manage" : "Learn more",
          },
        ]
      : []),
    {
      name: "Claude and Codex",
      description: "Connect external agents through the hosted TextText MCP.",
      status:
        clientCount === null
          ? "Checking"
          : `${clientCount} connected ${clientCount === 1 ? "client" : "clients"}`,
      connected: (clientCount ?? 0) > 0,
      href: "#settings-connected-clients",
      action: "Manage clients",
    },
    {
      name: "MCP servers",
      description: "Let your assistant use tools from services you approve.",
      status:
        mcpCount === null
          ? "Checking"
          : `${mcpCount} connected ${mcpCount === 1 ? "server" : "servers"}`,
      connected: (mcpCount ?? 0) > 0,
      href: "#settings-mcp",
      action: "Manage servers",
    },
  ];

  return (
    <section
      className={styles.section}
      aria-labelledby="settings-connection-gallery"
    >
      <div className={styles.header}>
        <div>
          <h2 id="settings-connection-gallery">Connect your AI</h2>
          <p>Choose how trusted agents can work with this workspace.</p>
        </div>
        <div className={styles.headerActions}>
          {onVerify ? (
            <button type="button" onClick={onVerify}>
              Verify connection
            </button>
          ) : null}
          <a className={styles.docs} href="/docs/ai">
            How connections work
          </a>
        </div>
      </div>
      <ul className={styles.grid}>
        {cards.map((card) => (
          <li className={styles.card} key={card.name}>
            <div className={styles.cardTop}>
              <h3>{card.name}</h3>
              <span className={card.connected ? styles.connected : styles.status}>
                {card.status}
              </span>
            </div>
            <p>{card.description}</p>
            <a href={card.href}>
              {card.action} <span aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
