"use client";

import type { ButtonHTMLAttributes } from "react";
import { signIn } from "next-auth/react";

type SignInButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "type"
> & {
  redirectTo?: string;
};

export function SignInButton({ redirectTo, ...props }: SignInButtonProps) {
  return (
    <button
      {...props}
      type="button"
      onClick={() => {
        void signIn("apple", redirectTo ? { redirectTo } : undefined);
      }}
    >
      Sign in with Apple
    </button>
  );
}
