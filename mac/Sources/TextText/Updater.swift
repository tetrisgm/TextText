#if TEXTTEXT_STORE

import Foundation

/// The Store edition has no updater: the App Store does the updating, and a
/// bundled self-updater is grounds for rejection on its own. This stub keeps
/// the call sites in AppDelegate identical between editions - `isConfigured`
/// is false, so the app never constructs one and the Check for Updates menu
/// item stays hidden.
final class Updater {
    static var isConfigured: Bool { false }
    init(isBusy: @escaping () -> Bool) {}
    func checkForUpdates() {}
    func checkNow() {}
    func busyDidEnd() {}
}

#else

import AppKit
import Foundation
import Sparkle

/// Wraps Sparkle's updater (EdDSA-verified). Feed URL + public EdDSA key come
/// from Info.plist (SUFeedURL / SUPublicEDKey), set by the release pipeline.
///
/// Update model: scheduled checks download verified updates in the background,
/// then Sparkle installs the latest on quit/relaunch. We LET SPARKLE MANAGE the
/// update; we do NOT take control via
/// willInstallUpdateOnQuit. Returning YES there stalls Sparkle's update
/// session and stops ALL future checks until the app quits, so on a
/// never-quit app a newer build would not be picked up until relaunch, and
/// "install now" would install a stale build, then prompt again. By not
/// taking control, checks keep running and Sparkle always stages the latest.
///
/// The only thing we control is WHEN Sparkle's install prompt appears: never
/// while a sync pass is in flight. The gentle-reminders hook defers it while
/// busy; once the engine is idle again, busyDidEnd() re-surfaces the held
/// update.
///
/// Construct this only AFTER moveToApplicationsIfNeeded: Sparkle cannot
/// update a translocated or Downloads copy.
final class Updater: NSObject, SPUUpdaterDelegate, SPUStandardUserDriverDelegate {
    /// Whether this build carries a usable update config: a real EdDSA public
    /// key (32 base64 bytes, so the committed REPLACE_WITH placeholder fails)
    /// and an https feed URL. Dev and localhost builds fail this, and the
    /// updater must then never be constructed: Sparkle would fail to start
    /// and greet the first launch with an "Unable to Check for Updates"
    /// alert for a feature that intentionally does not exist yet.
    static var isConfigured: Bool {
        let info = Bundle.main.infoDictionary ?? [:]
        guard let key = info["SUPublicEDKey"] as? String,
              let keyData = Data(base64Encoded: key), keyData.count == 32,
              let feed = info["SUFeedURL"] as? String,
              let feedURL = URL(string: feed), feedURL.scheme == "https"
        else { return false }
        return true
    }

    private var controller: SPUStandardUpdaterController!
    private let isBusy: () -> Bool
    private var deferredWhileBusy = false // an update withheld mid-sync; re-surface once idle

    init(isBusy: @escaping () -> Bool) {
        self.isBusy = isBusy
        super.init()
        controller = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: self,
            userDriverDelegate: self) // we drive gentle-reminder timing
        // Forced ON in code, not left to the first-run permission prompt or a
        // stale user default: every install behaves the same way.
        controller.updater.automaticallyChecksForUpdates = true
        // Download signed updates silently and let Sparkle stage them for the
        // next quit/relaunch. It does not interrupt the current writing or sync
        // session, and it keeps an installed app current without a manual
        // download ceremony.
        controller.updater.automaticallyDownloadsUpdates = true
    }

    /// A user-visible manual check (menu item).
    func checkForUpdates() {
        // A manual check surfaces any held update, so it is no longer
        // "deferred". Clear the latch; otherwise a later busyDidEnd would pop
        // a spurious "you're up to date" dialog.
        deferredWhileBusy = false
        controller.checkForUpdates(nil)
    }

    /// A silent background check: reacts to a push signal (the server
    /// advertises a newer build) or the app coming to the foreground, instead
    /// of waiting for Sparkle's hourly timer.
    func checkNow() {
        controller.updater.checkForUpdatesInBackground()
    }

    /// Call when the engine goes idle. If an update was deferred while a sync
    /// pass was in flight, surface it now. MUST use checkForUpdates, which
    /// routes to showing the held update in focus;
    /// checkForUpdatesInBackground early-returns while a scheduled session is
    /// pending, so the deferred update would never re-appear.
    func busyDidEnd() {
        guard deferredWhileBusy else { return }
        deferredWhileBusy = false
        controller.checkForUpdates(nil)
    }

    // MARK: Gentle scheduled-update reminders (SPUStandardUserDriverDelegate)

    var supportsGentleScheduledUpdateReminders: Bool { true }

    /// Idle -> let Sparkle show its prompt now. Mid-sync -> take
    /// responsibility (return false), show nothing, and re-surface via
    /// busyDidEnd() once the pass completes.
    func standardUserDriverShouldHandleShowingScheduledUpdate(
        _ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool
    ) -> Bool {
        if isBusy() {
            deferredWhileBusy = true
            return false
        }
        return true
    }

    /// When we declared we would handle showing (returned false above), we
    /// intentionally show nothing, deferring past the busy window.
    func standardUserDriverWillHandleShowingUpdate(
        _ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState
    ) {}
}

#endif
