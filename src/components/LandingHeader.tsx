import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

export function LandingHeader({
  signedIn,
}: {
  signedIn: boolean;
}) {
  return (
    <nav className="texttext-landing-nav" aria-label="TextText">
      <div className="texttext-landing-nav-left">
        <Link className="texttext-landing-mark" href="/">
          TextText
        </Link>
        <Link className="texttext-landing-nav-item" href="/download">
          Download
        </Link>
        <Link className="texttext-landing-nav-item" href="/docs/ai">
          Connect AI
        </Link>
      </div>
      <div className="texttext-landing-nav-actions">
        {signedIn ? (
          <>
            <Link className="texttext-landing-signin" href="/start?to=home">
              Open your inbox
            </Link>
            <SignOutButton className="texttext-landing-link" redirectTo="/" />
          </>
        ) : (
          // The hero owns the one pill on the page; the header stays quiet.
          <Link className="texttext-landing-signin" href="/start">
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
