// One source of truth for names no user may claim. Tenant subdomains
// ({handle}.{ROOT_DOMAIN}) and usernames (/@user) check the same base list,
// so a name reserved in one namespace is reserved in both.
//
// Note on "demo": it is reserved from claiming, but the seeded demo blog
// (handle and username "demo") must still resolve; the resolvers in
// tenants.ts and public-paths.ts special-case it.

const BASE_RESERVED_NAMES = [
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "blog",
  "bookmarks",
  "cdn",
  "dashboard",
  "demo",
  "dev",
  "docs",
  "editor",
  "feeds",
  "groups",
  "help",
  "login",
  "logout",
  "mail",
  "new",
  "notes",
  "pricing",
  "privacy",
  "settings",
  "sign-in",
  "sign-up",
  "staging",
  "start",
  "static",
  "status",
  "t",
  "terms",
  "u",
  "www",
] as const;

// Namespace-specific additions. Keep these short and deliberate; anything
// that should be off-limits everywhere belongs in the base list above.
const USERNAME_ONLY_RESERVED: readonly string[] = [];
const HANDLE_ONLY_RESERVED: readonly string[] = [];

/** Names no one may register as a /@username. */
export const RESERVED_USERNAMES = new Set<string>([
  ...BASE_RESERVED_NAMES,
  ...USERNAME_ONLY_RESERVED,
]);

/** Subdomains that can never be tenant handles. */
export const RESERVED_HANDLES = new Set<string>([
  ...BASE_RESERVED_NAMES,
  ...HANDLE_ONLY_RESERVED,
]);
