# Reader recovery and installed live synchronization

## Reproduced failure and correction

Installed Mac 1229 saved a complete shared image but wrote template name `gallery`
as the Markdown content kind. The shared parser requires `media_post`. Common
creation fix `f1ba5ec4` preserves the Gallery template while writing the valid
content kind. Five focused native share regressions and the exact-source gate
passed; build 1230 installed and visibly rendered the repaired original photo.

Repairing the dedicated fixture while its reader was open exposed a second
failure: `DocumentBoundary` latched the old error forever for the same item key.
Source `c0d37699` reloads failed readers on file notifications and resets only
after a different saved revision arrives. Healthy editors are untouched.
In-flight notifications coalesce and a later notification causes another read;
unmount aborts recovery and the parent rejects a stale item/root response.

Browser regression passed: transient read failure, automatic repair, notification
during a stale read, unsaved healthy draft preservation, and navigation during
a delayed read. It is included in `test:long-note-reader:browser`, which passed
with the existing long reader, rerender and backlink checks. TypeScript passed.
Logs: `/tmp/texttext-reader-recovery-{types,browser}.log`.

## Physical clients and live Oracle

Mac 1230 and signed-in production Safari opened the same dedicated CLI-created
file `Notes/Live sync acceptance 1231.textpack`, identity
`db4b0013-7afe-442a-bcee-64571c18ffa3`. Oracle remains `e722c893`.

- CLI append committed in 55 ms. Both already-open readers displayed the marker
  without reload at the first inspection about 8.7 seconds later. This is an
  observation bound, not a measured transfer latency.
- Native typing was visible in Safari at the first observation, 838 ms after
  starting the input action, with no Save action. This includes tool overhead.
- Reverse Safari typing was partially visible in the native editor at 824 ms;
  subsequent inspection confirmed the complete sentence. Do not report 824 ms
  as complete-sentence latency.
- Independent CLI read confirmed all three exact markers in the saved iCloud
  TextPack. Independent SSH inspection of the physical PC's TextPack confirmed
  the same identity and all three markers. No Windows UI acceptance is inferred.
- Both editors finished and returned to readers with all text retained.

These are same-account physical-client samples. Earlier isolated two-account
concurrent/reconnect evidence remains in `2026-10-08-current-client-acceptance.md`.
This does not establish a latency percentile, current Windows live typing,
second-device iCloud behavior, or the entire failure matrix.
