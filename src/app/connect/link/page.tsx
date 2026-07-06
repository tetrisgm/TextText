// The approval page a linking app opens in the owner's browser. Signed out,
// it routes through sign-in and back; signed in, it shows the app's name and
// the code the app is displaying, and one button.

import type { Metadata } from "next";
import { DeviceLinkApprove } from "@/components/DeviceLinkApprove";
import { cleanDeviceLinkCode, getPendingDeviceLink } from "@/lib/device-link";
import { getCurrentUser } from "@/lib/session";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Link a device",
  description: "Approve an app's request to sync with your workspace.",
};

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{ code?: string | string[] }>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="applecms connect-shell">
      <main className="connect-main">{children}</main>
    </div>
  );
}

export default async function DeviceLinkPage({ searchParams }: Props) {
  const query = (await searchParams) ?? {};
  const rawCode = Array.isArray(query.code) ? query.code[0] : query.code;
  const code = cleanDeviceLinkCode(rawCode);

  if (!code) {
    return (
      <Shell>
        <h1 className="connect-title">Link a device</h1>
        <p className="connect-lede">
          This link is missing its code. Start again from the app; it opens
          this page with everything filled in.
        </p>
      </Shell>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    const callback = `/connect/link?code=${encodeURIComponent(code)}`;
    return (
      <Shell>
        <h1 className="connect-title">Link a device</h1>
        <p className="connect-lede">
          Sign in to connect the app showing code <strong>{code}</strong> to
          your workspace.
        </p>
        <p>
          <a
            className="ac-btn ac-btn-filled"
            href={`/api/auth/signin?callbackUrl=${encodeURIComponent(callback)}`}
          >
            Sign in
          </a>
        </p>
      </Shell>
    );
  }

  const pending = await getPendingDeviceLink(code);
  if (!pending) {
    return (
      <Shell>
        <h1 className="connect-title">Link a device</h1>
        <p className="connect-lede">
          This code is no longer waiting: it expired or was already used.
          Start again from the app.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="connect-title">Link {pending.appName}?</h1>
      <p className="connect-lede">
        <strong>{pending.appName}</strong> wants to sync with your workspace.
        Only continue if the app on your screen is showing the code{" "}
        <strong>{code}</strong>.
      </p>
      <DeviceLinkApprove code={code} />
      <p className="connect-sub" style={{ marginTop: 16 }}>
        Linking gives the app its own token; you can revoke it any time from
        the Connect page.
      </p>
    </Shell>
  );
}
