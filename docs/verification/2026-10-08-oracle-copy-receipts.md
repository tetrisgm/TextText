# Oracle package-copy deployment

Source `e4ae9937`, deployment `texttext-oracle-20261008-e4ae9937-copy`.
Live path `/home/ubuntu/texttext/releases/20261008T200433Z-texttext-oracle-20261008-e4ae9937-copy-9f1905`.

Standalone build, Linux ARM64 packaging, matching required source receipts,
release/bootstrap checks and all 13 authenticated live checks passed.
Deployment created and validated its pre-migration backup. The previous release
remains available. TextText and all three Algorave services are active. No
HAProxy or Algorave configuration changed.

Includes shared new-identity mutation-receipt isolation and platform-neutral
web loading/provider labels. Actual Safari copy acceptance and Windows delivery
remain outstanding; passing deployment probes does not attest those flows.
Logs `/tmp/texttext-copy-oracle-{build,package,deploy}.log`.
No public Mac release was published.
