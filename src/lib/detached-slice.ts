// A short string taken from a long one, without keeping the long one alive.
//
// `long.slice(0, n)` in V8 produces a SlicedString: a view that holds a
// pointer to its parent. For a preview of a few hundred characters cut from
// a multi-megabyte document body, that view retains the WHOLE body. A heap
// snapshot showed exactly this - four copies of a 7MB document held alive by
// nothing but `bodyPreview` fields on old pool posts, about 3.5MB of
// retention per stale posts array.
//
// Splitting and rejoining forces V8 to build a fresh sequential string with
// no parent. It is O(n) in the SHORT length, which is the point: a couple of
// thousand characters, once, in exchange for not pinning a document.

export function detachedSlice(value: string, length: number): string {
  const cut = value.slice(0, length);
  // Already its own string; nothing to detach from.
  if (cut.length === value.length) return value;
  return cut.split("").join("");
}
