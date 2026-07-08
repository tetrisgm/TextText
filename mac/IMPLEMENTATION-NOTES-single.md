# Single-instance guard

The guard is in `AppDelegate.applicationDidFinishLaunching`, immediately after `moveToApplicationsIfNeeded()` returns false and before cache setup, updater setup, login item registration, menu bar setup, sync, capture, or web window creation.

The guard looks up running applications with the current bundle identifier, which is `net.writeapp.write.mac` in the production bundle. It ignores the current process, chooses only an older matching process, activates that process, waits 0.5 seconds, checks again, and terminates this launch if the older process is still running.

The move-to-Applications relaunch is preserved by passing `--write-moved-to-applications` through `NSWorkspace.OpenConfiguration.arguments` when launching the copied app from `/Applications`. The relaunched instance recognizes that argument and skips the duplicate guard, so it is not killed by briefly seeing the old source instance while the old instance is terminating.

The guard still runs for normal launches from duplicate app copies. Near-simultaneous normal launches keep the older process and terminate the newer one, using launch date with PID as the tie-breaker.
