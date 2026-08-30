# TextText for Mac

A native macOS shell and File Provider for TextText. It is pure AppKit and
SwiftPM, has one dependency (Sparkle), and supports Apple silicon Macs running
macOS 14 or later. The signed-in workspace appears as one Finder location.
Files stay available locally, while reads and writes use the same guarded sync
API as the web app and external agents. There is no second `~/TextText` mirror
or background mirror watcher.

## Dev loop

Run the web app, then the client against it:

    npm run dev                # the platform, on localhost:3000
    npm run mac:dev            # the client, against it

`mac/scripts/dev-run.sh` (what `npm run mac:dev` calls) waits for the server to
answer before launching, so a client started too early does not look like a
broken app.

The long form, if you want the flags in front of you:

    TEXTTEXT_SERVER=http://localhost:3000 TEXTTEXT_DEV_NO_MOVE=1 \
      swift run --package-path mac TextTextApp

A build with no release plist (anything from `swift run`) now defaults to
`http://localhost:3000` rather than the product origin, and every run prints
the origin it resolved to stderr on its first request:

    TextText server origin: http://localhost:3000 (dev build, no release feed)

That line exists because the old fallback sent a dev launch to the LIVE
workspace silently, which looks exactly like the app being broken.

- `TEXTTEXT_SERVER` points the client at any server origin (dev override).
- `TEXTTEXT_DEV_NO_MOVE=1` skips the move-to-Applications prompt. It is an env
  var on purpose, never a persisted default.
- `TEXTTEXT_STATE_DIR` relocates the state dir (credentials, index, trash) away
  from `~/Library/Application Support/TextText` for experiments.

Type-check/build only: `swift build --package-path mac`.

### One canonical local app

For a development build that should replace the installed copy, build the
bundle and run the deliberate installer from this checkout:

    mac/scripts/build-app.sh
    mac/scripts/install-local.sh

The installer accepts only the production bundle identifier, quits an existing
`/Applications/TextText.app` process, atomically swaps the bundle, and launches
that exact path. The previous bundle is moved to the macOS Trash for recovery;
it is never left beside the installed app. Do not launch the bundle from
`mac/build`, Finder Downloads, or a second Applications directory when testing
the installed build.

### Promote committed main to this Mac

When the owner wants the current committed `main` on the production origin and
in `/Applications/TextText.app`, without publishing a Sparkle or TestFlight
release, run:

    npm run promote:local

This is a deliberate production command. It requires a clean `main` equal to
`origin/main`, runs the exact release gates, generates the workflow and signed
build attestations, and chooses a build number greater than source and every
known local install. It then guards the Keychain-backed production Neon URL,
runs every ordered migration and content backfill, deploys one uniquely
identified prebuilt Vercel output, and exercises an authenticated scratch
workspace through the production MCP command surface.

Only after production passes does it replace the canonical Developer ID app.
The installer keeps the previous bundle and any numbered TestFlight collision
recoverable until the new app launches and writes a passing health report for
its exact version and build. A failed launch or health report restores the old
canonical app and rolls the Vercel production aliases back to their prior
deployment. Successful cleanup moves prior bundles to Trash and verifies that
only one TextText bundle and one app process remain. Database migrations are
idempotent forward migrations and are not reversed.

This command does not notarize, upload, change `/appcast.xml`, publish a Sparkle
archive, create a TestFlight package, or submit anything to Apple. `npm run
ship` and the TestFlight preparation commands remain separate owner decisions.

### Two executables, two names

The app target is `TextTextApp` and the CLI product is `texttext`. They used to
be `TextText` and `texttext`, which are the SAME path on a stock
case-insensitive Mac volume: both landed on `.build/debug/TextText` and
whichever linked last won, so `swift build` followed by `./.build/debug/TextText`
could run the CLI and look like the app failing to launch.

The shipped bundle binary is still `TextText.app/Contents/MacOS/TextText`;
`build-app.sh` copies `TextTextApp` into that name, so `CFBundleExecutable` is
unchanged and nothing about a release build moves.

## How sync works

- One replicated File Provider domain represents each signed-in workspace.
  Finder enumerates folders and files from the server-backed workspace API.
- Reads fetch a revision-consistent manifest and document. TextText asks macOS
  to download files eagerly and keep them available offline.
- Creates, edits, renames, and moves carry content hashes or revisions. A stale
  write returns a conflict instead of silently overwriting newer work.
- Notes and bookmarks remain private. Folder identity determines the kind of a
  newly created file, so a Finder write cannot accidentally publish one.
- Finder deletion is not advertised until it maps to TextText Trash. Permanent
  removal remains an explicit Empty Trash action in the app or agent surface.
- Remote-change signals refresh the domain and Spotlight metadata. The File
  Provider extension is the sole filesystem writer.

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
   (302 to Vercel Blob), plus `GET /api/app/version` -> `{version}` as the
   deployed release-identity check.
6. Icon: `mac/scripts/make-icon.sh` renders the newspaper emoji publishing mark
   into `mac/AppIcon.icns` and the asset catalog.

## Verify on a real Mac

- Fresh-Mac first run: download, open, zero permission prompts.
- Signing in creates exactly one TextText Finder location with no folder picker
  or Full Disk Access prompt.
- Create, edit, rename, and move a file in Finder; verify each change appears in
  the web workspace and survives relaunch and an offline retry.
- Link round trip: code in app matches browser, token mints, workspace 200s.
- Sparkle N to N+1 in place, passwordless, in `~/Applications`.
- Login item enrolled exactly once; System Settings toggle works.
- `spctl -a -vvv -t exec` and `codesign --verify --strict` pass.
