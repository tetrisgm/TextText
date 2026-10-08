# Graceful read-poll shutdown

## Cause and bounded fix

On Node 22.19.0 and Next 16.3.8, an isolated local production standalone server with a 25-second HTTP request received SIGTERM one second into that request. The response completed at 25.161 seconds, but `http.Server.close` did not finish until 31.163 seconds. Exit143 occurred 30.025 seconds after SIGTERM. The extra six seconds came before Next's subsequent cleanup, while the completed request's keep-alive connection remained open. This reproduces a race with the reported Oracle 30-second service stop limit without AI traffic or a database connection.

Next server instrumentation now installs one process-level read-drain controller. SIGTERM/SIGINT wake only the request-scoped manifest and collaboration waits. Next retains its own shutdown/exit handling, and durable writes are not cancelled. Importing the engine outside that lifecycle installs no signal handlers and preserves Node's default termination behavior.

## Evidence

- `sync/read-drain.test.ts`: isolated process tests cover ordinary Node SIGTERM, repeated lifecycle installation, 24 concurrent manifest/collaboration polls, no listener warning, and a durable write after read draining. Included in the mandatory core sync gate.
- `scripts/verify-production-shutdown.mjs`: bounded local production HTTP probe using the actual file-engine manifest wait, temporary files and dummy loopback database configuration. No real authentication, account, user file or model request is involved. The diagnostic URL exists only in the isolated child; no product bypass is installed.
- The existing ccf675f8 production build with the new lifecycle injected for this diagnostic exited143 in **6063ms**, without SIGKILL. The remaining delay is HTTP keep-alive; shutdown is not claimed to be instantaneous.
- Full TypeScript check and scoped lint passed.

Run the script against a freshly built standalone `server.js` with no optional flag to verify its actual compiled instrumentation. For an older build only, `--inject-lifecycle` explicitly installs the new controller in the isolated probe. The script is included in the sync source fingerprint. It does not build, deploy, change service timeouts or patch Next.
