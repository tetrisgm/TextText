import Link from "next/link";
import { SignInButton } from "@/components/SignInButton";

// Shown at /editor when auth is configured but no one is signed in. Keeps the
// Apple editor chrome so the sign-in is part of the same surface, not a detour.
export function SignInScreen() {
  return (
    <div
      className="applecms ac-editor-app"
      style={{ height: "100dvh", display: "flex", flexDirection: "column" }}
    >
      <div className="ac-toolbar ac-chrome">
        <Link href="/" className="ac-btn ac-btn-plain ac-back">
          <span aria-hidden="true">&#8249;</span>
          Write
        </Link>
        <div className="ac-toolbar-title ac-toolbar-title-grow">Editor</div>
      </div>
      <div className="ac-signin">
        <div className="ac-signin-card">
          <h1 className="ac-signin-title">Sign in to write</h1>
          <p className="ac-signin-sub">
            Your posts and drafts live in your own blog. Sign in with Apple to
            continue.
          </p>
          <SignInButton
            className="ac-btn ac-btn-filled ac-signin-btn"
            redirectTo="/editor"
          />
        </div>
      </div>
    </div>
  );
}
