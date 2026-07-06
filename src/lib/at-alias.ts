// Request header the proxy sets when it rewrites a canonical /@{username}
// URL to the internal /u/{username} route tree. Pages under /u treat its
// absence as a direct hit and redirect back to the /@ URL.
//
// This module stays dependency-free on purpose: the proxy imports it, and
// the proxy bundle must not pull in the store or other app modules.
export const AT_ALIAS_HEADER = "x-write-at-alias";
