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
          For agents
        </Link>
      </div>
      <div className="texttext-landing-nav-actions">
        {signedIn ? (
          <>
            <Link className="texttext-landing-button" href="/start?to=home">
              Open TextText
            </Link>
            <SignOutButton className="texttext-landing-link" redirectTo="/" />
          </>
        ) : (
          <>
            <Link className="texttext-landing-link" href="/try">
              Start writing
            </Link>
            <Link className="texttext-landing-button" href="/start">
              Get started
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
