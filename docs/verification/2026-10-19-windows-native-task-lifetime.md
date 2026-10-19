# Windows private native task lifetime

The private runner derives its scheduled task limit from the actor config: `max(22, TotalMinutes + 2)` for supported actor durations 1..120 minutes. The existing default remains 20-minute actor / 22-minute task; maximum is 120 / 122. This changes no normal product timeout or persistent maintenance job.

The relay parses and hashes one captured config byte buffer, pins the module, and passes both expected hashes to each task invocation. PowerShell hashes the exact captured config bytes, checks expected pins and current input bytes before registration, and rechecks actual task action, configured limit and inputs before start, inspection and finished-task removal.

## Verification

- Mac main: four lifetime Node tests plus 18 existing registration/fingerprint tests passed (22 total, no skips). Both official Windows and manual native Node lists include the new suite.
- Actual Windows PowerShell controlled harness: 40 assertions and parser check passed. Scheduler/process commands were mocked; zero tasks or actors launched. Cases cover default/maximum limits, malformed durations, wrong action/limit, independent caller hash mismatch, and config/module mutation after capture, during settings construction and registration. Changed bytes never reach Start; earlier changes never reach Register.
- The controlled harness remains private, with source, logs and proof at `/private/tmp/texttext-native-task-lifetime-af7-20261019/hardened/final-manifest.json`. Main task/relay bytes match its tested sources. Test-only import ordering was corrected so PowerShell module autoload could not replace the hash mock; the final mutation cases use the functioning mock.

No real long-running task, campaign, desktop actor, ownership collection or T24 acceptance is claimed. Existing finite transport/output limits remain unchanged.
