"use client";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
};

const statusUrl = process.env.NEXT_PUBLIC_STATUS_URL;

const globalStyles = `
@font-face {
  font-family: "Write Inter";
  src: url("/fonts/Inter-Regular.ttf") format("truetype");
  font-display: swap;
  font-style: normal;
  font-weight: 400;
}
@font-face {
  font-family: "Write Inter";
  src: url("/fonts/Inter-SemiBold.ttf") format("truetype");
  font-display: swap;
  font-style: normal;
  font-weight: 600;
}
@font-face {
  font-family: "Write Fraunces";
  src: url("/fonts/Fraunces-SemiBold.ttf") format("truetype");
  font-display: swap;
  font-style: normal;
  font-weight: 600;
}
:root {
  --ink: #1d1d1f;
  --ink-2: #424245;
  --muted: #6e6e73;
  --hairline: #d2d2d7;
  --bg: #ffffff;
  --accent: #0066cc;
  --font-newsroom-display: "Write Fraunces", -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Helvetica Neue", Arial, sans-serif;
  --font-newsroom-text: "Write Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #ffffff;
    --ink-2: #d4d4d8;
    --muted: #b3b3b3;
    --hairline: #2c2c2e;
    --bg: #1d1d1f;
  }
}
* {
  box-sizing: border-box;
}
html,
body {
  margin: 0;
  padding: 0;
}
body {
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-newsroom-text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.not-found-page {
  align-content: center;
  background: var(--bg);
  color: var(--ink);
  display: grid;
  gap: 20px;
  justify-items: center;
  min-height: 100dvh;
  padding: 24px;
  text-align: center;
}
.error-mark {
  border-bottom: 2px solid color-mix(in srgb, var(--accent) 60%, var(--ink));
  color: var(--muted);
  font-family: var(--font-newsroom-display);
  font-size: 58px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1;
  padding-bottom: 14px;
}
.not-found-title {
  color: var(--ink);
  font-family: var(--font-newsroom-display);
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0;
}
.error-copy {
  color: var(--ink-2);
  font-size: 16px;
  line-height: 1.55;
  margin: 0;
  max-width: 430px;
}
.error-id {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.4;
  margin: 0;
}
.error-id code {
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 12px;
}
.error-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  justify-content: center;
}
.error-button {
  appearance: none;
  background: var(--ink);
  border: 1px solid var(--ink);
  border-radius: 999px;
  color: var(--bg);
  cursor: pointer;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1;
  min-height: 38px;
  padding: 0 17px;
}
.not-found-home-link {
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
  color: color-mix(in srgb, var(--accent) 60%, var(--ink));
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0;
  text-decoration: none;
}
.not-found-home-link:hover {
  border-color: var(--accent);
  color: var(--ink);
}
.error-button:focus-visible,
.not-found-home-link:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 3px;
}
`;

export default function GlobalError({
  error,
  unstable_retry,
  reset,
}: GlobalErrorProps) {
  const retry = unstable_retry ?? reset;
  const errorId = errorReference(error);

  return (
    <html lang="en">
      <body>
        <title>Texttext error</title>
        <style>{globalStyles}</style>
        <main className="not-found-page">
          <div aria-hidden="true" className="error-mark">
            500
          </div>
          <h1 className="not-found-title">Something went wrong.</h1>
          <p className="error-copy">
            We could not load this view. Try again, or return home.
          </p>
          <p className="error-id">
            Error id <code>{errorId}</code>
          </p>
          <div className="error-actions">
            <button className="error-button" onClick={() => retry?.()} type="button">
              Try again
            </button>
            <a className="not-found-home-link" href="/">
              Go home
            </a>
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
      </body>
    </html>
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
