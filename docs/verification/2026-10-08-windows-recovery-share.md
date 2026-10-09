# Windows recovery update and fresh attachment delivery

Windows source `c0d37699` built and passed native core/agent checks, 346 shared
client tests, TypeScript, self-contained packaging and actual WPF/WebView smoke.
The smoke includes renderer flush failure, preserved open window, and file
activation waiting for durable flush. Candidate:
`C:\Users\Shokunin\dev\texttext-client-c0d37699\windows\build\candidate-cec7df020c164219b429d81e57d78d94`.
Log: `%TEMP%\texttext-windows-c0d37699-build.log`.
Smoke receipts: `windows/build/smoke-receipts-9f6a91a658a74a88bf570f842c102539`.

Before replacement, all current native checkpoints were neither pending nor
retired. Stopped only the verified canonical process 45512 under the owner's
explicit authorization. Candidate and staged artifact receipts passed. Installed
at `%LOCALAPPDATA%\Programs\TextText`, preserving prior app at
`TextText-previous-20261008T190454-ade21a70`. User files and journals retained.
Reopened on desktop session 1, PID 43648, Responding true. Zero temporary smoke
or launch tasks remain. This is not a claim of visible owner-window acceptance.

Fresh Finder Share on installed Mac 1231 created
`Gallery/Finder photo share 1231.textpack`, identity
`840df8e0-4dbb-4e1e-87ce-5dae03337ed9`, without manual metadata repair.
Independent ZIP inspection confirms `media_post`, Gallery presentation, and
exactly one original image. Native search found and opened the saved title and
image controls without error. Actual production Safari visibly rendered the
photo. Independent physical PC ZIP inspection found the same single asset hash:
`ed06a94f6b494148666ddcc13727aa3912aa8b750dab26da7d3f50fa620c6baf`.

This completes the fresh single-photo share path. It does not establish every
file type/size, multiple-file UI capture, live Windows typing, or physical iCloud
eviction behavior.
