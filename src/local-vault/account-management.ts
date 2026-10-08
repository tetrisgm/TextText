/** Browser OAuth uses the native account's server and explicitly names that account. */
export function accountManagementURL(site: string, accountId: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) return null;
  try {
    const url = new URL(site);
    if (url.username || url.password || !(url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) return null;
    url.pathname = "/account/sign-in-methods";
    url.search = new URLSearchParams({ account: accountId }).toString();
    url.hash = "";
    return url.href;
  } catch { return null; }
}
