"use client";

import { AccountMenu } from "./AccountMenu";
import { signOutFromWeb } from "./web-sign-out";

export function WebAccount({ email, name }: { email: string | null; name: string | null }) {
  return <AccountMenu signedIn initialIdentity={email || name} logOut={signOutFromWeb} />;
}
