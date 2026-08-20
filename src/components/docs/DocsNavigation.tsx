import Link from "next/link";

const groups = [
  {
    label: "Start",
    links: [["Getting started", "/docs/getting-started"]],
  },
  {
    label: "Write",
    links: [
      ["Work with an agent", "/docs/how-it-works"],
      ["Writing recipes", "/docs/recipes"],
      ["Features", "/docs/features"],
      ["Item types", "/docs/item-types"],
    ],
  },
  {
    label: "Connect",
    links: [
      ["Connect your AI", "/docs/ai"],
      ["MCP reference", "/docs/mcp"],
    ],
  },
  {
    label: "Trust",
    links: [
      ["Security", "/docs/security"],
      ["Troubleshooting", "/docs/troubleshooting"],
    ],
  },
] as const;

export function DocsNavigation() {
  return (
    <nav className="docs-navigation" aria-label="TextText documentation">
      <Link className="docs-navigation-home" href="/docs">
        <span className="docs-navigation-mark" aria-hidden="true">
          T
        </span>
        <span>
          <strong>TextText</strong>
          <small>Documentation</small>
        </span>
      </Link>
      <div className="docs-navigation-groups">
        {groups.map((group) => (
          <section className="docs-navigation-group" key={group.label}>
            <p>{group.label}</p>
            {group.links.map(([label, href]) => (
              <Link href={href} key={href}>
                {label}
              </Link>
            ))}
          </section>
        ))}
      </div>
      <Link className="docs-navigation-connect" href="/connect">
        Connect an AI
      </Link>
    </nav>
  );
}
