# Document look conflict recovery, 2026-09-29

The installed local TextText 0.202 (1113) opened **Customize this document**
on the private `Typing benchmark 7d924acf` scratch note. A request for a
simple note layout reached `/api/ai/item-type` and returned HTTP 409 because
the note's saved revision had advanced after the studio loaded it. The studio
showed **The AI provider request failed for an unknown reason**, even though
the provider was never called. Its catch block read `saveConflict` from the
render that started the request, immediately after calling
`setSaveConflict(true)`, then classified the conflict as an AI failure.

The studio now treats HTTP 409 and other non-provider 4xx responses as request
errors and keeps the server's safe message. It offers **Read latest document
and review** for 409, while preserving the typed request. On the same installed
app after the local web update, the saved request again received 409. The UI
showed **This document changed after the preview was opened** and the review
button. Review loaded the latest document and kept the request. Retrying then
made a real Anthropic generation and produced a `Note with source` first-draft
preview over the saved note content. I canceled without applying the look. A
local canonical-store read still showed the original `texttext.note` template,
title, and Typing marker at revision 492649.

Four focused test files passed 22 tests; TypeScript and `git diff --check`
passed. Touched-file ESLint had no errors and one pre-existing Hook dependency
warning. This proves one live local stale-revision recovery path. Other live
provider error classes and the native ChatGPT setup path remain open.
