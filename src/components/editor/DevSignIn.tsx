"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

// Dev-only email sign-in (see devLoginEnabled in src/auth.ts). Each email maps
// to its own user and blog, which is handy for exercising multi-tenant flows.
export function DevSignIn() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  return (
    <form
      className="ac-devsignin"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = email.trim();
        if (!trimmed) return;
        void signIn("dev-login", {
          email: trimmed,
          name: name.trim(),
          redirectTo: "/editor",
        });
      }}
    >
      <input
        className="ac-field"
        type="email"
        required
        placeholder="you@example.com"
        aria-label="Email"
        value={email}
        onChange={(event) => setEmail(event.currentTarget.value)}
      />
      <input
        className="ac-field"
        placeholder="Name (optional)"
        aria-label="Name"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <button className="ac-btn ac-btn-filled ac-signin-btn" type="submit">
        Sign in (dev)
      </button>
    </form>
  );
}
