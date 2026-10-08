# Normal Oracle shutdown classification

Source service template declares `SuccessExitStatus=130 143`, matching Next's graceful signal exit codes. Crashes still use `Restart=on-failure`; SIGKILL, segmentation faults and exit 1 are not success. All sixteen Oracle tests passed (`/tmp/texttext-oracle-normal-exit-tests.log`).

Read the existing live unit and verified fresh backup `texttext-20261008T174431Z-f693aba1.dump` plus active TextText/Algorave before applying the additive `/etc/systemd/system/texttext.service.d/normal-exit.conf` override. `systemd-analyze verify` passed; daemon-reload applied SuccessExitStatus 130/143. TextText stayed active at PID 3683421 and all three Algorave services remained active. No restart, new persistent job, shared routing change or user-content mutation occurred. The next ordinary rollout must verify the resulting systemd success status.
