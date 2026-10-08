# Gallery checkpoint live follow-up

Oracle live source: `c3c3ed2d`, release `texttext-oracle-20261008T172350Z-c3c3ed2d`.

Actual signed-in Safari reopened dedicated item `6ac14802-7f06-4587-8207-9313c4af847c` after deployment. The Gallery editor loaded with image, saved title, caption and the native agent's red-circle/blue-square summary. The previous rejection banner was absent. No content edits or recovery deletion were performed. Mac 1205 acceptance is recorded separately.

The owner's earlier completed retirement proposal URL returned the unavailable page on fresh navigation. Source already presents `Change applied.`, a workspace return link and collapsed technical details, without the raw completed receipt. That old proposal's rendered completion cannot be attested from this visit.

Shutdown remains unresolved: outgoing PID 3678089 continued serving manifest requests during drain; fixed-category diagnostics showed two manifest requests after 20 seconds and systemd killed it at 17:27:06 UTC. The new live release and all three Algorave services are active. No extra restart was performed. Investigate admission of new polls on existing keep-alive sockets during shutdown; preserve durable writes.

## Follow-up connection retirement

Shutdown lifecycle now marks active and subsequently admitted responses as non-keep-alive once draining starts. Operations complete normally; their connections then retire instead of accepting recurring proxy polls. All 15 Oracle tests passed, including a real reused HTTP socket with an in-flight POST whose result completes before server closure (`/tmp/texttext-drain-keepalive-tests.log`). The local standalone production build with the updated lifecycle passed the existing 25-second poll/pre-header socket shutdown probe in 9 ms, exit 143, without SIGKILL (`/tmp/texttext-drain-keepalive-production.log`). This is not a production rollout attestation; deploy and inspect its following shutdown before declaring the live failure resolved.
