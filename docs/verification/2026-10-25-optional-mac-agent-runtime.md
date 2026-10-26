# Mac release no longer requires an embedded agent executable

The unified release previously verified `/Applications/TextText.app/Contents/Helpers/codex`, required its version metadata, and copied it into every new local Store build. `build-store.sh` also refused a local build without the helper. That made a bundled assistant runtime a prerequisite for unrelated editor and file changes.

The unified release now explicitly clears the two embedded-runtime environment variables and builds without copying a prior helper. The local Store build accepts that configuration. The optional build-app helper path remains available for a separate intentional agent build; `mac/scripts/test-embedded-codex-version.sh` checks its version parsing when intentionally used. The app already reports the embedded agent as unavailable when no signed helper is bundled. The CLI, MCP and local TextPack access are unchanged.

Mac checks: `bash -n mac/scripts/build-store.sh`; `node --test release/stage-checkpoint.test.mjs` (9 passed). The owner's uncommitted `mac/Package.resolved` retained SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`. No build, install or deployment occurred for this source change.
