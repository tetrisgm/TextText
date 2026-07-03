"use client";

import type { ButtonHTMLAttributes } from "react";
import { signOut } from "next-auth/react";

type SignOutButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "type"
> & {
  redirectTo?: string;
};

export function SignOutButton({ redirectTo, ...props }: SignOutButtonProps) {
  return (
    <button
      {...props}
      type="button"
      onClick={() => {
        void signOut(redirectTo ? { redirectTo } : undefined);
      }}
    >
      Sign out
    </button>
  );
}
