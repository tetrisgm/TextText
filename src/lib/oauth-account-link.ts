import { getToken, type JWT } from "@auth/core/jwt";
import { verifyLinkIntent } from "./link-intent";

/** OAuth callbacks receive a fresh provider token; only the incoming session cookie identifies the account being linked. */
export async function completeOAuthAccountLink(input: {
  intent: string; secret: string; cookieHeader: string; secure: boolean; subject: string;
  link: (userId: string, subject: string) => Promise<"linked" | "already-yours" | "taken">;
}): Promise<JWT> {
  const userId = verifyLinkIntent(input.intent, input.secret);
  if (!userId) throw new Error("The account connection expired. Try again from Settings.");
  const cookieName = `${input.secure ? "__Secure-" : ""}authjs.session-token`;
  const session = await getToken({ req: new Request("https://texttext.invalid/", { headers: { cookie: input.cookieHeader } }),
    secret: input.secret, cookieName, salt: cookieName });
  if (!session || session.userId !== userId || typeof session.sub !== "string" || !session.sub) {
    throw new Error("Sign in to the original account before connecting another sign-in method.");
  }
  const outcome = await input.link(userId, input.subject);
  if (outcome === "taken") throw new Error("This sign-in method belongs to another account.");
  return session;
}
