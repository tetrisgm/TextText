/** Finish local persistence before invalidating the browser's account session. */
export async function signOutFromWeb() {
  const flush = (window as Window & { texttextFlushForSignOut?: () => Promise<boolean> }).texttextFlushForSignOut;
  if (!flush || !await flush()) throw new Error("Your edits have not finished saving. Please keep this window open.");
  const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
  if (!csrf.ok) throw new Error("Could not start sign out.");
  const { csrfToken } = await csrf.json() as { csrfToken?: string };
  if (!csrfToken) throw new Error("Could not start sign out.");
  const response = await fetch("/api/auth/signout", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
    body: new URLSearchParams({ csrfToken, callbackUrl: "/signin" }),
  });
  if (!response.ok) throw new Error("Could not sign out.");
  const result = await response.json() as { url?: string };
  const destination = result.url ? new URL(result.url, window.location.origin) : new URL("/signin", window.location.origin);
  window.location.assign(destination.origin === window.location.origin ? destination.href : "/signin");
}
