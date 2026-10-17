/** A nonsecret precondition, never an authorization source. Old clients may omit
 * it; account-bound clients always capture the server-resolved user ID. */
export const VAULT_ACCOUNT_HEADER = "X-TextText-Account";
export function vaultAccountFence(request: Request, actorUserId: string): Response | null {
  const expected = request.headers.get(VAULT_ACCOUNT_HEADER);
  if (expected === null || expected === actorUserId) return null;
  return Response.json({ code: "account_changed", error: "Your account changed. Reopen this workspace to continue." }, {
    status: 403, headers: { "Cache-Control": "private, no-store" },
  });
}
