import { timingSafeEqual } from "node:crypto";

type AppHealthReviewAuthorization =
  | "authorized"
  | "unauthorized"
  | "unconfigured";

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function authorizeAppHealthReview(
  authorizationHeader: string | null,
): AppHealthReviewAuthorization {
  const expected = process.env.APP_HEALTH_REVIEW_TOKEN;
  if (!expected || expected.length < 32 || expected.length > 512) {
    return "unconfigured";
  }

  const actual = bearerToken(authorizationHeader);
  if (!actual) return "unauthorized";
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length) return "unauthorized";
  return timingSafeEqual(expectedBytes, actualBytes)
    ? "authorized"
    : "unauthorized";
}
