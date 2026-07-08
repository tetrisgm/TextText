import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  allowInsecureLocalhostOAuthRedirects,
  authorizationErrorRedirect,
  validateOAuthAuthorizationParams,
} from "@/lib/oauth";
import { loadOAuthClients } from "../clients";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Authorize",
  description: "Authorize a connector to sync with your workspace.",
};

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function toUrlSearchParams(
  query: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (typeof value === "string") {
      params.append(key, value);
    }
  }
  return params;
}

function authorizePath(params: URLSearchParams): string {
  const query = params.toString();
  return `/oauth/authorize${query ? `?${query}` : ""}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="applecms connect-shell">
      <main className="connect-main">{children}</main>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <Shell>
      <h1 className="connect-title">Authorization failed</h1>
      <p className="connect-lede">{message}</p>
    </Shell>
  );
}

export default async function OAuthAuthorizePage({ searchParams }: Props) {
  const params = toUrlSearchParams((await searchParams) ?? {});
  const user = await getCurrentUser();

  if (!user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(authorizePath(params))}`,
    );
  }

  const clients = await loadOAuthClients();
  const validation = validateOAuthAuthorizationParams(params, {
    clients,
    allowInsecureLocalhost: allowInsecureLocalhostOAuthRedirects(),
  });

  if (!validation.ok) {
    if (validation.redirectUri) {
      redirect(
        authorizationErrorRedirect(
          validation.redirectUri,
          validation.error,
          validation.state,
        ),
      );
    }
    return <ErrorView message={validation.error.message} />;
  }

  const request = validation.request;

  return (
    <Shell>
      <h1 className="connect-title">Authorize {request.client.name}?</h1>
      <p className="connect-lede">
        <strong>{request.client.name}</strong> wants access to sync your
        workspace.
      </p>
      <p className="connect-sub">
        Scope: <span className="connect-inline-code">{request.scope}</span>
      </p>
      <form
        action="/oauth/authorize/approve"
        method="post"
        className="connect-link-actions"
      >
        <input type="hidden" name="decision" value="approve" />
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="client_id" value={request.clientId} />
        <input type="hidden" name="redirect_uri" value={request.redirectUri} />
        <input type="hidden" name="scope" value={request.scope} />
        <input
          type="hidden"
          name="code_challenge"
          value={request.codeChallenge}
        />
        <input type="hidden" name="code_challenge_method" value="S256" />
        {request.state !== undefined && (
          <input type="hidden" name="state" value={request.state} />
        )}
        <button className="ac-btn ac-btn-filled" type="submit">
          Authorize
        </button>
      </form>
      <p className="connect-sub" style={{ marginTop: 16 }}>
        You can revoke the token later from Connect.
      </p>
    </Shell>
  );
}
