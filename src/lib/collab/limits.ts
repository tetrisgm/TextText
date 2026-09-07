/** Shared by the relay and all local text insertion paths. Base64 characters. */
export const MAX_UPDATE_CHARS = 512 * 1024;

// Base64 encodes three bytes in four characters. Reserve half of the decoded
// budget for Yjs structure, deletion sets and accompanying document metadata.
// UTF-8 takes at most three bytes per UTF-16 code unit (a pair takes four).
export const MAX_TEXT_CHUNK_UNITS = Math.floor(
  (Math.floor(MAX_UPDATE_CHARS / 4) * 3) / 2 / 3,
);
