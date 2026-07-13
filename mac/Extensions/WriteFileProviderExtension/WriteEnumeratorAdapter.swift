import FileProvider
import Foundation
import WriteFileProviderKit
import WriteFileProviderBridge

/// Wraps the pure-Swift `WorkspaceEnumerator` as an `NSFileProviderEnumerator`.
/// One adapter per container. The workspace is small, so every container is
/// enumerated in a single page. Change tracking re-lists the container and
/// fingerprints its actual mapped children; the long-poll that decides WHEN to
/// re-enumerate lives in the container app (ChangeListener -> signalEnumerator),
/// not here.
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
        let container = self.container
        let core = self.core
        Task {
            switch await core.containerAnchor(for: container) {
            case .success(let anchor):
                completionHandler(NSFileProviderSyncAnchor(anchor))
            case .failure:
                completionHandler(nil) // the system retries
            }
        }
    }

    func enumerateChanges(
        for observer: any NSFileProviderChangeObserver,
        from syncAnchor: NSFileProviderSyncAnchor
    ) {
        // Anchors fingerprint this container's actual mapped child set. A global
        // workspace cursor made an unrelated edit expire every folder. We still
        // expire on a real child-set difference so deletions reconcile cleanly.
        let container = self.container
        let core = self.core
        Task {
            let expired = NSError(
                domain: NSFileProviderErrorDomain,
                code: NSFileProviderError.syncAnchorExpired.rawValue)
            switch await core.containerAnchor(for: container) {
            case .success(let anchor):
                if syncAnchor.rawValue == anchor {
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
            // Mutation entry points resolve 412s with current item metadata (or
            // localVersionConflictingWithServer for an explicit fail-on-conflict
            // request). This fallback is intentionally not
            // versionNoLongerAvailable, which is reserved for strict fetches.
            return fp(.cannotSynchronize)
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
