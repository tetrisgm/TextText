"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimBlog, updateBlogNameAction } from "@/app/editor/actions";

type ActionError = string | null;

function signInUrl(handle: string): string {
  const callbackUrl = `/t/${encodeURIComponent(handle)}?claim=1`;
  return `/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

function cleanDraftName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function BlogNameForm({
  handle,
  initialName,
}: {
  handle: string;
  initialName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<ActionError>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const committedName = useRef(initialName);
  const requestId = useRef(0);
  const skipNextBlur = useRef(false);

  useEffect(() => {
    committedName.current = initialName;
    setName(initialName);
    setError(null);
  }, [initialName]);

  const commitName = useCallback(
    (value: string) => {
      const nextName = cleanDraftName(value);
      setName(nextName);
      setError(null);

      if (nextName === committedName.current) return;

      const currentRequestId = requestId.current + 1;
      requestId.current = currentRequestId;
      setSaving(true);
      startTransition(() => {
        void updateBlogNameAction(handle, nextName)
          .then((result) => {
            if (requestId.current !== currentRequestId) return;
            if (!result.ok) {
              setError(result.error);
              return;
            }

            const savedName = result.name;
            committedName.current = savedName;
            setName((currentName) =>
              cleanDraftName(currentName) === nextName ? savedName : currentName,
            );
            router.refresh();
          })
          .catch(() => {
            if (requestId.current === currentRequestId) {
              setError("Could not save");
            }
          })
          .finally(() => {
            if (requestId.current === currentRequestId) {
              setSaving(false);
            }
          });
      });
    },
    [handle, router],
  );

  return (
    <div
      className="blog-name-form"
      aria-busy={saving}
    >
      <input
        className="blog-name-input"
        value={name}
        placeholder="Name your blog"
        aria-label="Blog name"
        onBlur={(event) => {
          if (skipNextBlur.current) {
            skipNextBlur.current = false;
            return;
          }
          commitName(event.currentTarget.value);
        }}
        onChange={(event) => {
          setName(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            skipNextBlur.current = true;
            setName(committedName.current);
            setError(null);
            event.currentTarget.blur();
          }
        }}
      />
      {error && (
        <span className="blog-home-control-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function ClaimBlogButton({
  handle,
  publicPath,
  signedIn,
  authConfigured,
  autoClaim = false,
}: {
  handle: string;
  publicPath: string;
  signedIn: boolean;
  authConfigured: boolean;
  autoClaim?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<ActionError>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [pending, startTransition] = useTransition();
  const autoStarted = useRef(false);
  const copiedTimer = useRef<number | null>(null);
  const disabled = claiming || pending;
  const publicUrl = origin ? `${origin}${publicPath}` : publicPath;

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

  const copyPublicLink = useCallback(
    (input: HTMLInputElement) => {
      input.select();
      if (!navigator.clipboard) return;
      void navigator.clipboard
        .writeText(publicUrl)
        .then(() => {
          setCopied(true);
          if (copiedTimer.current !== null) {
            window.clearTimeout(copiedTimer.current);
          }
          copiedTimer.current = window.setTimeout(() => {
            setCopied(false);
            copiedTimer.current = null;
          }, 1400);
        })
        .catch(() => {});
    },
    [publicUrl],
  );

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!autoClaim || !signedIn || autoStarted.current) return;
    autoStarted.current = true;
    runClaim();
  }, [autoClaim, runClaim, signedIn]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  return (
    <div className="blog-claim-row applecms">
      <label className="blog-public-link">
        <span className="blog-public-link-label">Public link</span>
        <input
          className="blog-public-link-field"
          value={publicUrl}
          readOnly
          aria-label="Public link"
          onClick={(event) => copyPublicLink(event.currentTarget)}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <button
        className="blog-claim-button ac-btn ac-btn-gray"
        type="button"
        disabled={disabled}
        onClick={runClaim}
      >
        {disabled ? "Claiming" : "Claim to keep it forever"}
      </button>
      <span className="ac-sr-only" role="status">
        {copied ? "Copied" : ""}
      </span>
      {error && (
        <span className="blog-home-control-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
