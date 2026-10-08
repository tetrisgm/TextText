// tar uses CRLF on Windows. Remove only its line terminator, not path whitespace.
export function runtimeArchiveEntries(listing) {
  const names = listing.split(/\r?\n/).filter(Boolean);
  if (names.some(name => name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\') || name.split('/').includes('..'))) {
    throw new Error('Invalid package paths');
  }
  return names;
}
