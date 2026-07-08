import type { CSSProperties } from "react";
import Link from "next/link";

const markStyle: CSSProperties = {
  borderBottom: "2px solid color-mix(in srgb, var(--accent) 60%, var(--ink))",
  color: "var(--muted)",
  fontFamily: "var(--font-newsroom-display)",
  fontSize: 58,
  fontWeight: 700,
  letterSpacing: 0,
  lineHeight: 1,
  paddingBottom: 14,
};

const copyStyle: CSSProperties = {
  color: "var(--ink-2)",
  fontSize: 16,
  lineHeight: 1.55,
  margin: 0,
  maxWidth: 420,
};

export default function NotFound() {
  return (
    <main className="not-found-page">
      <div aria-hidden="true" style={markStyle}>
        404
      </div>
      <h1 className="not-found-title">This page does not exist.</h1>
      <p style={copyStyle}>The link may have moved, or the page may be private.</p>
      <Link className="not-found-home-link" href="/">
        Go home
      </Link>
    </main>
  );
}
