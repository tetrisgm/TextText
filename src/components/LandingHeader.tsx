import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

const signInHref = `/signin?callbackUrl=${encodeURIComponent("/start")}`;

// The public header, Notion-shaped: the wordmark top-left, a couple of nav
// links, and the actions on the right that switch on whether you are signed
// in (Open Write / Sign out) or not (Try the demo / Sign in).
export function LandingHeader({
  signedIn,
}: {
  signedIn: boolean;
}) {
  return (
    <nav className="write-landing-nav" aria-label="Write">
      <div className="write-landing-nav-left">
        <Link className="write-landing-mark" href="/">
          Write
        </Link>
        <Link className="write-landing-nav-item" href="/download">
          Download
        </Link>
        <Link className="write-landing-nav-item" href="/docs/ai">
          For agents
        </Link>
      </div>
      <div className="write-landing-nav-actions">
        {signedIn ? (
          <>
            <Link className="write-landing-button" href="/start?to=home">
              Open Write
            </Link>
            <SignOutButton className="write-landing-link" redirectTo="/" />
          </>
        ) : (
          <>
            <Link className="write-landing-link" href="/try">
              Try the demo
            </Link>
            <a className="write-landing-button" href={signInHref}>
              Sign in
            </a>
          </>
        )}
      </div>
    </nav>
  );
}
