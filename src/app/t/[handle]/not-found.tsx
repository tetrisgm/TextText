import Link from "next/link";

export default function TenantNotFound() {
  return (
    <main className="not-found-page">
      <div className="not-found-inner">
        <span className="not-found-kicker">Not found</span>
        <h1 className="not-found-title">Nothing is published here.</h1>
        <p className="not-found-copy">
          This blog or post is unavailable, unpublished, or no longer at this
          address.
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
