# TextText for Mac

A native markdown sync client for the TextText platform. Pure AppKit, SwiftPM
only (no .xcodeproj), one dependency (Sparkle), and supported on Apple silicon
with macOS 14 or later. It mirrors your workspace's folders to a local
directory:

    ~/TextText/
      blog/my-first-post.md
      notes/an-idea.md
      bookmarks/a-good-read.md

Edit the files with anything; the app pushes changes to your blog and pulls
the server's edits back, with conflicted copies (never silent overwrites)
when both sides moved.

## Dev loop

Run the web app, then the client against it:

    npm run dev                # the platform, on localhost:3000
    TEXTTEXT_SERVER=http://localhost:3000 TEXTTEXT_DEV_NO_MOVE=1 \
      swift run --package-path mac

- `TEXTTEXT_SERVER` points the client at any server origin (dev override).
- `TEXTTEXT_DEV_NO_MOVE=1` skips the move-to-Applications prompt. It is an env
  var on purpose, never a persisted default.
- `TEXTTEXT_STATE_DIR` relocates the state dir (credentials, index, trash) away
  from `~/Library/Application Support/TextText` for experiments.

Type-check/build only: `swift build --package-path mac`.

### Headless verify mode (CI, agents)

One real sync pass through the real engine, one JSON line, exit 0/1:

    TEXTTEXT_HEADLESS=1 \
    TEXTTEXT_TOKEN=wsk_... \
    TEXTTEXT_SERVER=http://localhost:3000 \
    TEXTTEXT_SYNC_ROOT=/tmp/texttext-sync \
    TEXTTEXT_STATE_DIR=/tmp/texttext-state \
      swift run --package-path mac
    # -> {"pulled":3,"pushed":0,"conflicts":0,"errors":0}

Mint the token by approving a device link (or via the link flow itself:
`POST /api/link/start`, approve in a signed-in browser, `POST /api/link/poll`).

## How sync works

- The index (`index.json` in the state dir) records, per post, the last
  hash both sides agreed on. Every decision is a three-way compare of the
  remote hash (folder manifest), the indexed hash, and the local file hash.
- Pull: new remote files are written locally; remote-only changes overwrite
  clean local files; when both sides changed, the server copy takes the
  filename and your edit is preserved next to it as
  `name (conflicted copy yyyy-mm-dd hhmm).md` (never auto-pushed).
- Push: local edits go up with a content-hash precondition so the server can
  refuse stale writes (412 becomes the same conflicted-copy dance). `PUT` and
  `DELETE` use `If-Match`; hosted metadata `PATCH` uses
  `X-TextText-If-Match` because Vercel otherwise consumes the standard header
  before TextText's route runs. New `.md` files are created on the server; files
  deleted locally are deleted there. Files the server deletes move to the
  state dir's `trash/`, never `rm`.
- The server's slug is authoritative: renames on the server rename local
  files. A file dropped into `notes/` without a `kind` becomes a note, and
  so on per folder.
- Full pass every 60s, on wake, and on demand; file changes trigger a
  debounced push pass (FSEvents, 2s).
- The default sync root is `~/TextText`. Desktop, Documents, and Downloads are
  deliberately avoided as defaults (macOS privacy prompts); any folder the
  user picks via the Change button works.

## Release ritual (owner's Mac, no CI secrets)

    release/ship.sh 0.2

That bumps the version (CFBundleVersion auto-increments), builds and signs
inside-out with the auto-detected Developer ID identity, notarizes + staples
(refuses without the notary profile), zips with ditto, signs the appcast,
and prints/executes the upload steps in the only safe order: versioned zip,
appcast, stable alias, advertised-version pointer last.

TextText and its three app extensions are built and verified as arm64-only.
Sparkle remains universal. The generated, uploaded, and publicly deployed
appcast must carry an arm64 hardware requirement before the ship command can
complete. The exact element is
`<sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>`. The signed
build attestation also requires content-blind capability receipts for folder
Trash/restore, sharing/access, comments, bookmark recapture, and cover/assets.

`mac/scripts/release.sh` is the lower-level artifact publisher. The owner
command calls it only after the source gates pass and the workflow capability
receipt exists; invoking it without those release-gate inputs fails closed.

Committed defaults use bundle id `com.example.texttext.mac`, domain
`TextText.app`, and key `REPLACE_WITH_SPARKLE_PUBLIC_KEY`. Release values are
injected via the env vars above; they are applied to the staged plist inside
the .app, never to the committed `mac/Info.plist`.

## One-time owner setup

1. Developer ID Application certificate in the login keychain (the build
   script auto-detects it; `TEXTTEXT_SIGN_ID` overrides).
2. Notary profile: create an app-specific password at appleid.apple.com,
   then
   `xcrun notarytool store-credentials "texttext-notary" --apple-id "<apple-id-email>" --team-id "<TEAMID>"`.
3. Sparkle keys, ONCE: `swift build --package-path mac` materializes the
   Sparkle CLI at `mac/.build/artifacts/sparkle/Sparkle/bin/`. Run
   `generate_keys` (private key lands in the login keychain), back it up
   with `generate_keys -x sparkle-backup.txt` into a password manager, then
   delete the file. Losing the private key strands every install. Put the
   public key in your release env (`TEXTTEXT_SPARKLE_PUBLIC_KEY`).
4. Pick the real bundle id and product domain and use the same values every
   release: bundle id stability is load-bearing for Sparkle, login items,
   and user defaults.
5. Server routes to add when shipping: `/appcast.xml` and `/download/*`
   (302 to Vercel Blob) and `GET /api/app/version` -> `{version}` for the
   push-triggered update check (the client tolerates its absence).
6. Icon: `mac/scripts/make-icon.sh` renders `mac/AppIcon.icns` (a quiet
   serif W, ink on paper).

## Verify on a real Mac (headless cannot)

- Fresh-Mac first run: download, open, zero permission prompts.
- `~/TextText` creation triggers no dialog; a picked folder works too.
- Link round trip: code in app matches browser, token mints, workspace 200s.
- Sparkle N to N+1 in place, passwordless, in `~/Applications`.
- Login item enrolled exactly once; System Settings toggle works.
- `spctl -a -vvv -t exec` and `codesign --verify --strict` pass.
