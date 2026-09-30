# File-backed article capture and notes

Installed local WIP **0.202 (1121)**. Core `f3340047`; editor/native integration
`88a7df47`. This advances the full product goal; it does not complete read-later
or the full brief.

## Behavior

A saved standalone link is durable before extraction starts. On opening a new
link placeholder, the editor makes one bounded capture request. Failures remain
usable links and persist a failed status; retry is explicit. Open original is
always available. No AI is required. The current extraction service requires
an existing TextText account; local note/link saving remains available offline.

The existing article parser is shared with the previous reading implementation.
The server reuses public-address validation, pinned DNS, and redirect checking.
It fetches no cookies and runs no page scripts/browser engine. HTML is bounded
to 2 MB and 15 seconds; the request is aborted on every exit, including rejected
Content-Length, to release unread streams. The authenticated route returns
source data and never mutates content itself.

Normal guarded file saves persist captured source, timestamp, status, and
commentary in the same validated DocumentSnapshot/TextPack. Untouched link
placeholders or previous source bodies can be enriched; authored or concurrently
changed bodies remain intact with captured source retained separately. Changed
source URLs and newer captures fence late callbacks. Unknown fields, chosen
presentation, original title and assets remain intact. Refresh preserves notes.

## Proof

- 16 focused tests passed: parser, bounded fetch, unread response cleanup,
  authentication before fetch, invalid input, failure disclosure, initial
  capture, refresh, authored/concurrent edits, annotations, changed-source and
  late-callback fencing. `/tmp/texttext-article-capture-tests.log`.
- Offline browser regression now verifies automatic extraction via a mock
  transport, same-file article body and saved commentary, with zero HTTP/fetch
  requests from that fixture. `/tmp/texttext-article-browser.log`.
- Web transport/browser regression passed: shared editor, pack preservation,
  updates and creation. `/tmp/texttext-article-web-browser.log`.
- Scoped ESLint, full TypeScript and final Next production build passed.
  `/tmp/texttext-article-next-final.log`.
- Native signed build/three extensions passed; canonical app replacement and
  launch verified. `/tmp/texttext-article-mac.log`,
  `/tmp/texttext-article-install.log`. Sandbox-private installer runtime health
  was unavailable, so installed UI and actual files were verified directly.
- Installed Mac captured `https://www.rfc-editor.org/rfc/rfc2606.html` into a
  temporary Reading pack. The UI showed local saved-link state during fetching,
  then captured article with 7,959 body characters and the original source.
  A personal note survived an explicit source refresh and was verified inside
  document.json. The temporary fixture was deleted through recoverable UI.

## Runtime and next work

Authorized local server replacement serves `.texttext/vault-article-final-build`
with identity `texttext-vault-article-final-20260930`, port 3000, file root
`/Users/shokunin/dev/TextText/.texttext/vault-server`. Start command is the same
as the previous receipt with those dist/identity values; live tool session is
56885. Log: `/tmp/texttext-vault-server-3000.log`. Inspect the listener before
future changes. No public deployment, push, release, or persistent job.

Next: focused reader presentation with persistent highlights and a usable source
comparison, then folder image/GIF capture and visual navigation. Extraction still
uses the bounded existing heuristic; it does not render JavaScript-only pages
or archive remote images for offline access. Fetch-on-open is not yet a durable
queue draining all unopened pending links. All other full-goal requirements in
HANDOFF remain active, including genuine multi-user integration and current-path
performance measurements.
