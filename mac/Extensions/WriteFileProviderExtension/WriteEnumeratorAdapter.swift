import FileProvider
import Foundation
import WriteFileProviderKit
import WriteFileProviderBridge

/// Wraps the pure-Swift `WorkspaceEnumerator` as an `NSFileProviderEnumerator`.
/// One adapter per container. The workspace is small, so every container is
/// enumerated in a single page. Change tracking re-lists the container and
/// finishes at the fresh server cursor; the long-poll that decides WHEN to
/// re-enumerate lives in the container app (ChangeListener -> signalEnumerator),
/// not here, so these methods always return promptly.
final class WriteEnumeratorAdapter: NSObject, NSFileProviderEnumerator {
    private let container: WriteItemIdentifier
    private let core: WorkspaceEnumerator

    init(container: WriteItemIdentifier, core: WorkspaceEnumerator) {
        self.container = container
        self.core = core
    }

    func invalidate() {
        // The core is a value type holding no long-lived resource; nothing to do.
    }

    func enumerateItems(
        for observer: any NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        let container = self.container
        let core = self.core
        Task {
            switch await core.children(of: container) {
            case .success(let items):
                observer.didEnumerate(items.map(WriteFileProviderItem.init))
                observer.finishEnumerating(upTo: nil) // one page, no continuation
            case .failure(let error):
                observer.finishEnumeratingWithError(Self.bridge(error))
            }
        }
    }

    func currentSyncAnchor(
        completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void
    ) {
        let core = self.core
        Task {
            switch await core.currentCursor() {
            case .success(let cursor):
                completionHandler(NSFileProviderSyncAnchor(Data(cursor.utf8)))
            case .failure:
                completionHandler(nil) // the system retries
            }
        }
    }

    func enumerateChanges(
        for observer: any NSFileProviderChangeObserver,
        from syncAnchor: NSFileProviderSyncAnchor
    ) {
        // The /changes cursor tells us THAT the workspace moved, not which items,
        // so we cannot emit a precise per-anchor delta. Re-listing survivors via
        // didUpdate would never report DELETIONS: a post removed on the web would
        // linger as a Finder ghost, and editing it PUTs to a dead id in a retry
        // loop. So when something HAS changed we expire the anchor, which makes
        // the system throw its state away and call enumerateItems for a full
        // reconcile that drops the deleted item cleanly.
        //
        // But the system probes for changes on every idle tick. Expiring
        // unconditionally forces a full re-enumeration each time, even when
        // nothing moved. So first compare the supplied anchor to the current
        // cursor: if they match, finish with no changes; only expire when they
        // differ. The workspace is small, so the full re-list on a real change
        // is cheap.
        let core = self.core
        Task {
            let expired = NSError(
                domain: NSFileProviderErrorDomain,
                code: NSFileProviderError.syncAnchorExpired.rawValue)
            switch await core.currentCursor() {
            case .success(let cursor):
                if syncAnchor.rawValue == Data(cursor.utf8) {
                    observer.finishEnumeratingChanges(upTo: syncAnchor, moreComing: false)
                } else {
                    observer.finishEnumeratingWithError(expired)
                }
            case .failure:
                // Cursor unknown: fall back to the deletion-correct full reconcile.
                observer.finishEnumeratingWithError(expired)
            }
        }
    }

    /// Map a sync error onto the File Provider error the system expects.
    static func bridge(_ error: WriteSyncError) -> NSError {
        switch error {
        case .notFound:
            return fp(.noSuchItem)
        case .conflict:
            // The base version was stale (412). versionNoLongerAvailable tells
            // the framework to re-read the current version and re-apply, instead
            // of retrying the same stale base hash forever (serverUnreachable
            // would loop).
            return fp(.versionNoLongerAvailable)
        case .rejected(let message):
            // The bytes themselves are the problem (400); retrying is futile, so
            // do not use a transient FP error that would loop.
            return NSError(
                domain: NSCocoaErrorDomain, code: NSFeatureUnsupportedError,
                userInfo: [NSLocalizedDescriptionKey: message])
        case .http(let status, _) where status == 401 || status == 403:
            return fp(.notAuthenticated)
        default:
            return fp(.serverUnreachable) // transient; the system backs off and retries
        }
    }

    private static func fp(_ code: NSFileProviderError.Code) -> NSError {
        NSError(domain: NSFileProviderErrorDomain, code: code.rawValue)
    }
}
