// Stable textual projection shared by the hosted browser stress actors.
// Playwright serializes this function into the page, so it must be self-contained.
export function readBody(selector, doc = document) {
  const el = doc.querySelector(selector);
  return el ? el.textContent ?? '' : null;
}
