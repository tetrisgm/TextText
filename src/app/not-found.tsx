import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <div className="not-found-inner">
        <span className="not-found-kicker">404</span>
        <h1 className="not-found-title">This page is not on the desk.</h1>
        <p className="not-found-copy">
          The address may have moved, or the draft may never have been published.
        </p>
        <div className="not-found-actions">
          <Link className="not-found-link" href="/">
            Return home
          </Link>
          <Link
            className="not-found-link not-found-link-secondary"
            href="/t/demo"
          >
            Read the demo
          </Link>
        </div>
      </div>
    </main>
  );
}
