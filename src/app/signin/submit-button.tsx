"use client";

import { useFormStatus } from "react-dom";

type ProviderMark = "apple" | "google";

type SignInSubmitButtonProps = {
  className: string;
  idleLabel: string;
  pendingLabel: string;
  mark?: ProviderMark;
};

function AppleMark() {
  return (
    <svg
      aria-hidden="true"
      className="signin-provider-mark"
      viewBox="0 0 24 24"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M16.4 12.6c0-2.1 1.7-3.1 1.8-3.2-1-1.5-2.6-1.7-3.2-1.7-1.3-.1-2.6.8-3.3.8-.7 0-1.8-.8-2.9-.8-1.5 0-2.9.9-3.7 2.2-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.7 2.4 2.9 2.3 1.1 0 1.6-.7 2.9-.7 1.4 0 1.8.7 3 .7 1.2 0 2-1.1 2.8-2.2.9-1.3 1.2-2.5 1.2-2.6 0 0-2.6-1-2.6-3.9ZM14.1 6.3c.6-.8 1.1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3Z"
      />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      className="signin-provider-mark"
      viewBox="0 0 24 24"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.4c-.2 1.2-.9 2.3-2 3v2.4h3.2c1.8-1.7 3-4.2 3-7.1Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.6-2.5l-3.2-2.4c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3.1v2.5C4.8 19.7 8.2 22 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 13.9c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V7.6H3.1C2.4 8.9 2 10.4 2 12s.4 3.1 1.1 4.4l3.3-2.5Z"
      />
      <path
        fill="#EA4335"
        d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3 14.7 2 12 2 8.2 2 4.8 4.3 3.1 7.6l3.3 2.5C7.2 7.8 9.4 6 12 6Z"
      />
    </svg>
  );
}

export function SignInSubmitButton({
  className,
  idleLabel,
  pendingLabel,
  mark,
}: SignInSubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      disabled={pending}
      aria-disabled={pending}
    >
      {mark === "apple" && <AppleMark />}
      {mark === "google" && <GoogleMark />}
      <span>{pending ? pendingLabel : idleLabel}</span>
    </button>
  );
}
