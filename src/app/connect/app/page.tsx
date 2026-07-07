// The Write desktop app's link landing. The app's web view loads this after
// sign-in; it mints the app's sync token and hands it back over the native
// bridge (see AppLinkBridge). Signed out, it bounces to /signin and returns
// here, so the app only ever shows sign-in first, never the public landing.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { AppLinkBridge } from "@/components/AppLinkBridge";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Connect Write",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConnectAppPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/connect/app")}`);
  }
  return <AppLinkBridge />;
}
