/** Native compatibility proof, never a server capability or workspace floor. */
export type LocalHandoffCapability = { version: 1; profileVersion: 4 };
export function isLocalHandoffCapability(value: unknown): value is LocalHandoffCapability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes("version") && keys.includes("profileVersion") &&
    Object.getOwnPropertyDescriptor(value, "version")?.value === 1 && Object.getOwnPropertyDescriptor(value, "profileVersion")?.value === 4;
}
