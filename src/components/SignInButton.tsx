"use client";

import type { ButtonHTMLAttributes } from "react";
import { signIn } from "next-auth/react";

type SignInButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "type"
> & {
  redirectTo?: string;
  provider?: "apple" | "google";
};

export function SignInButton({ redirectTo, provider = "apple", ...props }: SignInButtonProps) {
  return (
    <button
      {...props}
      type="button"
      onClick={() => {
        void signIn(provider, redirectTo ? { redirectTo } : undefined);
      }}
    >
      Sign in with {provider === "apple" ? "Apple" : "Google"}
    </button>
  );
}
