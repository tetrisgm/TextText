# Identity-bound creation browser gate

Unified candidate `d42b95265cb7764f81dace6e8fc77e3480ecc177` stopped before delivery because the real browser gate still waited for the old physical filename `Untitled.textpack`. Its delivery manifest has an empty delivered list; the Windows candidate completed, and the owner Mac pin was restored unchanged.

The focused browser test now observes the actual newly created identity, verifies its exact identity-bound filename and unchanged blank document title, then waits for that same file in the reader header. Existing fixture filenames elsewhere remain intentional. No product code changed.

The corrected full `verify-web-browser.mjs` passed on the Mac with the release Node 22 runtime, covering shared editing, save, retained assets, external refresh and creation. Log: `/private/tmp/texttext-d42-browser-correction.log`. This is a source browser regression, not installed acceptance. No release retry was invoked.
