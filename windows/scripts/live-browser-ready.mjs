// Shared-document readiness gate for the browser acceptance runner. Mirrors
// TextText.LiveAcceptance/Program.cs: the editor must sit inside the
// collaboration section that reports "ready" for the planned item. A
// local-only editor (textbox present, no shared state) must not pass.
// Runs inside the page via Playwright, so it must stay self-contained: no
// closures over module scope, only the `itemId` argument and `document`.
export function sharedEditorReady(itemId, doc = globalThis.document) {
  const shared = doc.querySelector('[data-collaboration-state="ready"]');
  return !!shared && shared.getAttribute('data-collaboration-item') === itemId &&
    !!shared.querySelector('[aria-label="Document body"]')?.isContentEditable;
}
