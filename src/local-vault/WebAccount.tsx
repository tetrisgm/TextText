"use client";

import { useEffect, useRef, useState } from "react";

export function WebAccount({ email, name }: { email: string | null; name: string | null }) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState("");
  const container = useRef<HTMLElement>(null);
  const identity = email || name || "TextText account";
  const initial = Array.from(identity).find((character) => /\p{L}|\p{N}/u.test(character))?.toUpperCase() || "T";

  const logOut = async () => {
    setFailure("");
    try {
      const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
      if (!csrf.ok) throw new Error("Could not start sign out.");
      const { csrfToken } = await csrf.json() as { csrfToken?: string };
      if (!csrfToken) throw new Error("Could not start sign out.");
      const response = await fetch("/api/auth/signout", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
        body: new URLSearchParams({ csrfToken, callbackUrl: "/signin" }),
      });
      if (!response.ok) throw new Error("Could not sign out.");
      const result = await response.json() as { url?: string };
      const destination = result.url ? new URL(result.url, window.location.origin) : new URL("/signin", window.location.origin);
      window.location.assign(destination.origin === window.location.origin ? destination.href : "/signin");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not sign out.");
    }
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  return <section ref={container} className="vault-connection" aria-label="TextText account">
    <button type="button" className="vault-account-toggle" aria-expanded={open} aria-controls="vault-web-account-menu"
      onClick={() => setOpen((value) => !value)}>
      <span className="vault-account-avatar" aria-hidden="true">{initial}</span>
      <span className="vault-account-label"><strong title={identity}>{identity}</strong><small>Signed in</small></span>
      <span className="vault-account-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div id="vault-web-account-menu" className="vault-account-menu">
      <button type="button" onClick={() => void logOut()}>Log out</button>
      {failure && <div className="vault-account-message" role="alert"><p>{failure}</p></div>}
    </div>}
  </section>;
}
