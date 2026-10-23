# First unified release gate

The human-invoked Mac command `bash release/ship-all.sh` ran at `b05a675e`.
Its full release gate and `npm run test:sync` passed. This proves those source
checks only; it is not installed acceptance.

While its sync child completed, the coordinator was paused before delivery to
integrate the independently identified normal-quit and preservation fixes.
After the child exited, the checkout advanced to `090ea78d`. Resuming the
coordinator produced the expected refusal: the release receipt's source commit
was stale. No receipt was rewritten or bypassed.

The coordinator's normal cleanup restored the owner's `mac/Package.resolved`
SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`
and removed its own release lock. The run's `delivery.json` records
`"delivered": []`. No web deployment or native installation occurred.

Mac evidence: `/private/tmp/texttext-ship-all-b05a675e.log` and
`~/dev/TextText/.texttext/ship-all/20261023055157155-b05a675e/`.
The next invocation must produce fresh source-bound receipts.
