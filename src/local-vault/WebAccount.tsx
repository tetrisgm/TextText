"use client";

import { AccountMenu } from "./AccountMenu";
import { WebAiSettings } from "./WebAiSettings";
import { signOutFromWeb } from "./web-sign-out";

export function WebAccount({ email, name, assistantHandle }: { email: string | null; name: string | null; assistantHandle?: string }) {
  return <AccountMenu signedIn initialIdentity={email || name} logOut={signOutFromWeb} aiSettings={assistantHandle ? <WebAiSettings handle={assistantHandle} /> : undefined} />;
}
