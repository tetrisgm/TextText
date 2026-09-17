import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed note that ties a GitHub installation back to the person and
 * workspace that asked for it.
 *
 * Installing the GitHub App is a round trip through github.com that ends on
 * our setup URL carrying an installation id. Installation ids are small
 * integers, so the id alone proves nothing: anyone signed in could name
 * somebody else's installation. The state cookie is minted by a route that
 * verified the live session, names that user and workspace, is short-lived,
 * and is signed so the browser cannot editorialise. The setup route then
 * confirms through GitHub's own OAuth that the person at the keyboard can see
 * the installation before anything is stored.
 */

const VERSION = "v1";
export const INSTALL_STATE_COOKIE = "texttext-github-install";
export const INSTALL_STATE_MAX_AGE_SECONDS = 10 * 60;

export type InstallState = { userId: string; blogId: string; installationId: number | null };

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function mintInstallState(state: InstallState, secret: string, now: number = Date.now()): string {
  const expires = Math.floor(now / 1000) + INSTALL_STATE_MAX_AGE_SECONDS;
  const payload = [VERSION, state.userId, state.blogId, state.installationId ?? "", expires].join(".");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyInstallState(value: string | undefined, secret: string, now: number = Date.now()): InstallState | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 6 || parts[0] !== VERSION) return null;
  const [, userId, blogId, installation, expiresRaw, provided] = parts;
  const expires = Number(expiresRaw);
  if (!userId || !blogId || !Number.isFinite(expires) || expires * 1000 < now) return null;
  const expected = signature(parts.slice(0, 5).join("."), secret);
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return null;
  const installationId = installation === "" ? null : Number(installation);
  if (installationId !== null && !(Number.isInteger(installationId) && installationId > 0)) return null;
  return { userId, blogId, installationId };
}
