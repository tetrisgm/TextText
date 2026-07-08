import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

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
              Start writing
            </Link>
            <Link className="write-landing-button" href="/start">
              Get started
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
