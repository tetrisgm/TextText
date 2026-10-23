# Phase 1: deployment and Windows checkout preflights

Evidence: October 22 Windows hashes were invalidated by system `autocrlf=true`;
Oracle previously refused its backup after the expensive build and transfer.

Windows builds now require checkout-local `core.autocrlf=false`. Oracle deploys
read the protected backup configuration on the server and check its full archive
budget plus free-space floor before building or transferring. No configuration
or existing files are changed by either preflight. Dry runs remain offline.

Mac checks: two storage boundary/invalid-input regressions, one real temporary-Git
configuration regression, and all 16 Oracle regressions passed. Shell syntax
passed. The real Oracle preflight passed with 28,930,703,360 bytes available and
7,516,192,768 required. No deploy or installed acceptance is claimed here.
