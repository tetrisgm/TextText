# Phase 1: combined release entry

`bash release/ship-all.sh` is a human-invoked Mac command. It pulls main, checks
the elevated Windows checkout against the same commit, prepares native candidates
with existing gates, deploys through `deploy:web`, and uses the supported local
installers. It does not publish a public Mac update or schedule future work.

Standalone Sparkle pins remain canonical in git. The command preserves the
owner's Store pin before using the committed pin, restores it even after a build
failure, and refuses to overwrite an unexpected concurrent edit. Per-run evidence
under `.texttext/ship-all/` records completed surfaces even on partial failure.

Mac tests: three pin/source-identity regressions and two stopped-backup
regressions passed. These cover restoration after failure, concurrent edits,
wrong commits, exact copies including links, and interleaved source edits.
Shell syntax/help passed; Windows helper PowerShell parsing passed on the PC.
Existing installers retain their own signature, source, artifact and health gates.

The combined command has not yet delivered a release. Real installed acceptance
remains required, separately from these orchestration tests.
