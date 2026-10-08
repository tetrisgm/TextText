# Oracle Gallery and shutdown acceptance

Live `texttext-oracle-20261008-3a115301-gallery`, source `3a115301`, release `/home/ubuntu/texttext/releases/20261008T174359Z-texttext-oracle-20261008-3a115301-gallery-8333fc`. Exact-source core/native checks, package, backup, bootstrap/migrations and all thirteen live deployment checks passed. Fresh backup `texttext-20261008T174431Z-f693aba1.dump`; previous release retained. All TextText/Algorave services active.

The outgoing corrected server PID 3682145 received its shutdown signal at 17:45:07 UTC and exited normally with code 143 at the same timestamp. No stop timeout or SIGKILL occurred. Systemd currently labels Next's 143 exit as a failure; classify this expected signal exit correctly in the reviewed service configuration before declaring shutdown observability complete.

Actual signed-in Safari refreshed the dedicated Gallery item after rollout. The single-photo editor shows all four original model tags plus `Mac editor verification 1206`, matching the saved Mac TextPack. Summary/caption/title remained intact. Refresh was used to load the new UI bundle, so this does not prove uninterrupted old-client reconnection. No Safari edits or storage clearing occurred.

Logs: `/tmp/texttext-gallery1206-oracle-build.log`, `/tmp/texttext-gallery1206-oracle-package.log`, `/tmp/texttext-gallery1206-oracle-deploy.log`. Mac acceptance is recorded separately. Windows remains pending closure of the older process.
