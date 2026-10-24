# Installed Windows Keep both recovery

Unified release `30f167dfbd56dce35a3225460ff2a0c2ff76989d` delivered the same commit to Windows, Mac and web. On October 23 local time (October 24 UTC), the real installed Windows app recovered the known same-path collision through Search and actions → Trash and recovery → Inspect → Keep both notes. No filesystem repair, journal reset, deletion or forced exit was used.

The review displayed local UUID `080a76d5-f83d-456f-b893-67b869d27af2`, shared UUID `ee455de6-5640-453c-8632-7984a370688c`, original `Notes/Untitled 31.textpack`, and unique destination `Notes/Recovered-080a76d5-f83d-456f-b893-67b869d27af2.textpack`. Resolution `a4e155d0-fd97-4206-ada0-33b4e1ce25e5` was durably completed by 00:02:20 UTC. Normal sync subsequently uploaded the local copy and pulled the shared copy; at 00:03:46 both baselines were present with no pending operations for either identity.

Read-only canonical ZIP verification and authenticated hosted GET agree on both complete pack hashes:

| Identity | Path | SHA-256 |
| --- | --- | --- |
| `080a76d5-f83d-456f-b893-67b869d27af2` | `Notes/Recovered-080a76d5-f83d-456f-b893-67b869d27af2.textpack` | `9fe65e46a9d134a6740bf1a138ee921171c5bb2238830453bb6f824c65c05a00` |
| `ee455de6-5640-453c-8632-7984a370688c` | `Notes/Untitled 31.textpack` | `5962859c2aae6ceb6893685962ba1b35804582f4dae3ddc84c24fbd4ed1026f9` |

The local body remained exactly the previous Windows acceptance body, including its newline and `Windows 044e5441 exact reopen verified.` The restored shared body retained all previous web/Mac markers through `Mac 044e5441 build1280 verified.` Normal `CloseMainWindow` returned true at 00:04:47.733 UTC; process exit was confirmed at 00:04:48.014. Reopened PID 45824 started at 00:04:55.598. Both identities, bodies and whole-pack hashes remained exact after reopen.

This proves installed recovery and durability, not the five-launch performance target. First PID 68636 started at 23:59:50.754 UTC; sparse snapshots observed the initial placeholder then the restored listing/body by 00:00:02.789, without a precise readiness measurement. One stack during the inspection wait showed an idle dispatcher and worker threads; it does not attribute that delay. No repeated timing loop was run.

## Web edit and Windows reopen

Safari saved one real keyboard append, ` Web 30f167df verified.`, to the shared identity at 00:09:32 UTC. Windows's already-open reader still showed the old body at 00:09:45.962 and its canonical pack still had the old hash at 00:09:55.321. This bounded observation does not pass live convergence.

Normal close of PID 45824 returned true at 00:10:08.271 and exit was confirmed at 00:10:08.423. Reopened PID 65672 started at 00:10:13.481. The real restored reader displayed the full prior body plus the exact web marker and a presence indicator. At 00:10:30.065 the shared canonical pack hash was `0bc7505470d6887f97e8f8e71ca0042db62c35845ef36151bd46a6f37182face`, identical to the authenticated server pack; recovered local UUID `080a…` retained hash `9fe65e46…c05a00`. Windows did not type. This passes web-to-Windows reopen convergence and preserves both recovered documents; it does not establish simultaneous editing or Mac live convergence.
