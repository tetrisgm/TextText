import Link from "next/link";

const footerColumns = [
  {
    title: "Company",
    links: [
      { href: "/support", label: "Support" },
      { href: "/security", label: "Security" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
  {
    title: "Download",
    links: [{ href: "/download", label: "Mac app" }],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs/ai", label: "AI docs" },
      { href: "/llms.txt", label: "llms.txt" },
      { href: "/connect", label: "Connect" },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="texttext-landing-footer" aria-label="Footer">
      <div className="texttext-landing-footer-inner">
        <div className="texttext-landing-footer-brand">
          <Link className="texttext-landing-footer-mark" href="/">
            TextText
          </Link>
          <p>Folders, Markdown, and publishing in one quiet workspace.</p>
        </div>
        <div className="texttext-landing-footer-columns">
          {footerColumns.map((column) => (
            <section key={column.title} aria-labelledby={`footer-${column.title}`}>
              <h2 id={`footer-${column.title}`}>{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </footer>
  );
}
