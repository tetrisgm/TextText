// The approval page a linking app opens in the owner's browser. Signed out,
// it routes through sign-in and back; signed in, it shows the app's name and
// the code the app is displaying, and one button. The button is a PLAIN HTML
// form posting a server action: approval must work even when the client
// bundle never hydrates (Safari with a stale dev chunk taught us this).

import type { Metadata } from "next";
import { approveDeviceLinkFormAction } from "@/app/connect/link/actions";
import { cleanDeviceLinkCode, getPendingDeviceLink } from "@/lib/device-link";
import { getCurrentUser } from "@/lib/session";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Link a device",
  description: "Approve an app's request to sync with your workspace.",
};

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{
    code?: string | string[];
    approved?: string | string[];
    error?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
  const code = cleanDeviceLinkCode(first(query.code));
  const approved = first(query.approved) === "1";
  const errorMessage = first(query.error)?.slice(0, 200);

  if (approved) {
    return (
      <Shell>
        <h1 className="connect-title">Linked</h1>
        <p className="connect-lede">
          You can return to the app; it connects on its own within a few
          seconds.
        </p>
        <p className="connect-sub">
          The app now holds its own token; you can revoke it any time from the
          Connect page.
        </p>
      </Shell>
    );
  }

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
          Start again from the app; it will show a fresh code.
        </p>
        {errorMessage && (
          <p className="connect-link-error" role="alert">
            {errorMessage}
          </p>
        )}
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
      <form action={approveDeviceLinkFormAction} className="connect-link-actions">
        <input type="hidden" name="code" value={code} />
        <button className="ac-btn ac-btn-filled" type="submit">
          Link this app
        </button>
      </form>
      {errorMessage && (
        <p className="connect-link-error" role="alert">
          {errorMessage}
        </p>
      )}
      <p className="connect-sub" style={{ marginTop: 16 }}>
        Linking gives the app its own token; you can revoke it any time from
        the Connect page.
      </p>
    </Shell>
  );
}
