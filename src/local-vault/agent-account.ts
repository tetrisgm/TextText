const MAX_ACCOUNT_EMAIL_LENGTH = 254;

export function connectedAccountLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (!email || email.length > MAX_ACCOUNT_EMAIL_LENGTH || /[\u0000-\u001f\u007f]/.test(email)) return null;
  return `Connected as ${email}`;
}
