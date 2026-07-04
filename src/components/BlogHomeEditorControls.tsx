"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimBlog, updateBlogNameAction } from "@/app/editor/actions";

type ActionError = string | null;

function signInUrl(handle: string): string {
  const callbackUrl = `/t/${encodeURIComponent(handle)}?claim=1`;
  return `/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

export function BlogNameForm({ handle }: { handle: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<ActionError>(null);
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();
  const disabled = saving || pending;

  return (
    <form
      className="blog-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setSaving(true);
        startTransition(() => {
          void updateBlogNameAction(handle, name)
            .then((result) => {
              if (!result.ok) {
                setError(result.error);
                return;
              }
              router.refresh();
            })
            .catch(() => setError("Could not save"))
            .finally(() => setSaving(false));
        });
      }}
    >
      <input
        className="blog-name-input"
        value={name}
        placeholder="Name your blog"
        aria-label="Blog name"
        disabled={disabled}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <button
        className="blog-name-save ac-btn ac-btn-filled"
        type="submit"
        disabled={disabled}
      >
        {disabled ? "Saving" : "Save"}
      </button>
      {error && (
        <span className="blog-home-control-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

export function ClaimBlogButton({
  handle,
  signedIn,
  authConfigured,
  autoClaim = false,
}: {
  handle: string;
  signedIn: boolean;
  authConfigured: boolean;
  autoClaim?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<ActionError>(null);
  const [claiming, setClaiming] = useState(false);
  const [pending, startTransition] = useTransition();
  const autoStarted = useRef(false);
  const disabled = claiming || pending;

  const runClaim = useCallback(() => {
    setError(null);
    if (!signedIn) {
      if (!authConfigured) {
        setError("Sign-in is not configured.");
        return;
      }
      window.location.assign(signInUrl(handle));
      return;
    }

    setClaiming(true);
    startTransition(() => {
      void claimBlog(handle)
        .then((result) => {
          if (!result.ok) {
            if (result.signInRequired && authConfigured) {
              window.location.assign(signInUrl(handle));
              return;
            }
            setError(result.error);
            return;
          }
          router.replace(`/t/${encodeURIComponent(result.handle)}`);
          router.refresh();
        })
        .catch(() => setError("Could not claim"))
        .finally(() => setClaiming(false));
    });
  }, [authConfigured, handle, router, signedIn]);

  useEffect(() => {
    if (!autoClaim || !signedIn || autoStarted.current) return;
    autoStarted.current = true;
    runClaim();
  }, [autoClaim, runClaim, signedIn]);

  return (
    <div className="blog-claim-control">
      <button
        className="blog-claim-button ac-btn ac-btn-gray"
        type="button"
        disabled={disabled}
        onClick={runClaim}
      >
        {disabled ? "Claiming" : "Claim this blog"}
      </button>
      {error && (
        <span className="blog-home-control-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
