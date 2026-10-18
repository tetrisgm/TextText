# Documentation verification before a pristine build

The actual local candidate pipeline for `1b53aa23` stopped at `docs.no_rot` with 47 findings. Earlier release checks and all five actor-flag Mac tests passed; no complete release receipt, app build, install or deployment was produced. The failed archive and logs remain at `/private/tmp/texttext-final-local-store-1263-20261018` and `/private/tmp/texttext-final-local-candidate-1263-1b53aa23.log`. Its package lock was restored.

Six archived handoffs lacked replacement banners and retained links relative to their old location. Their banners now identify the current handoff; 29 link targets were repaired. A private comparison verified the historical text was otherwise unchanged and checked 99 local links.

The source-path checker also required the canonical generated app bundle before its build. The path parser now excludes only that exact generated bundle; unknown files in the build directory and other app names remain checked. Build, signature and runtime-health checks remain mandatory. A new regression failed with three other tests passing, then all four passed. No placeholder app was created.

A deliberate nonexistent Swift input in the source-proof test now constructs its path from components, retaining the same rejection test without presenting the fixture as a repository file. Preservation notes still identify the untracked probe by basename and directory; the probe is neither copied into the archive nor committed.

Verification: documentation check passed (377 documents, 219 scripts, nine archived); four path-parser tests passed; 18 artifact-source tests passed; TypeScript checks and whitespace checks passed. Logs are `/private/tmp/texttext-pristine-docs-working-20261018.log`, `/private/tmp/texttext-pristine-doc-paths-red-20261018.log`, `/private/tmp/texttext-pristine-doc-paths-green-20261018.log`, `/private/tmp/texttext-pristine-doc-source-20261018.log`, and `/private/tmp/texttext-pristine-doc-types-20261018.log`.

Next: freeze the corrected commit and run the complete candidate pipeline again in a fresh pristine archive. The failed run is not accepted as a complete release gate or a candidate health pass.
