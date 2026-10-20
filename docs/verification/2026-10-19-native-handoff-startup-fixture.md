# Native handoff restart fixture correction

The 56d144f7 candidate required browser gate failed at verify-native-handoff-restart.mts:148: explicit native open returned blocked instead of opened. Original log: `/private/tmp/texttext-normal-1274-56d144f7-resume-20261019.log`; original fixture `texttext-native-handoff-restart-5VKz5k` is preserved.

The fixture restored all localStorage, including the last selected location, and then explicitly opened that same file through texttextOpenFile. VaultApp independently restores that location. If automatic restoration mounted the deliberately failed certified-startup owner first, the second navigation was correctly blocked by its retained draft. An unchanged focused rerun passed (`/private/tmp/texttext-certified-startup-focused-20261019.log`), establishing scheduling sensitivity rather than a reproducible product failure.

The test now omits only its owned last-location key from the restarted context so the explicit native startup request is the sole open. Every retained draft/journal byte remains unchanged; four intentional startup refusals, retry, native close fencing, peer append, exact text and no duplicate operation assertions remain. No product source, timeout, or safety guard changed. The frozen candidate was not patched.

Corrected focused certified-startup and ordinary restart cases passed: `/private/tmp/texttext-certified-startup-corrected-20261019.log` and `/private/tmp/texttext-handoff-restart-corrected-20261019.log`. Test SHA256: `a6db2bde4354b6e4a4a70b1999b8b94558725b6060c38dcf933741b7648b511b`. Candidate continuation must use a truthful new source attribution for this test-only correction.
