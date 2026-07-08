"use client";

import type { CSSProperties } from "react";
import Link from "next/link";

type ErrorPageProps = {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
};

const statusUrl = process.env.NEXT_PUBLIC_STATUS_URL;

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
  maxWidth: 430,
};

const idStyle: CSSProperties = {
  color: "var(--muted)",
  fontSize: 13,
  lineHeight: 1.4,
  margin: 0,
};

const codeStyle: CSSProperties = {
  color: "var(--ink-2)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

const actionsStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: 14,
  justifyContent: "center",
};

const buttonStyle: CSSProperties = {
  appearance: "none",
  background: "var(--ink)",
  border: "1px solid var(--ink)",
  borderRadius: 999,
  color: "var(--bg)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: 0,
  lineHeight: 1,
  minHeight: 38,
  padding: "0 17px",
};

export default function ErrorPage({
  error,
  unstable_retry,
  reset,
}: ErrorPageProps) {
  const retry = unstable_retry ?? reset;
  const errorId = errorReference(error);

  return (
    <main className="not-found-page">
      <div aria-hidden="true" style={markStyle}>
        500
      </div>
      <h1 className="not-found-title">Something went wrong.</h1>
      <p style={copyStyle}>
        We could not load this view. Try again, or return home.
      </p>
      <p style={idStyle}>
        Error id <code style={codeStyle}>{errorId}</code>
      </p>
      <div style={actionsStyle}>
        <button type="button" onClick={() => retry?.()} style={buttonStyle}>
          Try again
        </button>
        <Link className="not-found-home-link" href="/">
          Go home
        </Link>
        {statusUrl ? (
          <a
            className="not-found-home-link"
            href={statusUrl}
            rel="noreferrer"
            target="_blank"
          >
            Status
          </a>
        ) : null}
      </div>
    </main>
  );
}

function errorReference(error: Error & { digest?: string }): string {
  if (error.digest) return `err-${error.digest}`;
  return `err-${hashString(`${error.name}:${error.message}`)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}
