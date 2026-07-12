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
        let container = self.container
        let core = self.core
        Task {
            let anchorResult = await core.currentCursor()
            switch await core.children(of: container) {
            case .success(let items):
                // The /changes cursor tells us THAT the workspace moved and the
                // new cursor, not which items. We re-list the container as
                // updates; the system diffs against what it holds to surface
                // renames and (on folder re-enumeration) deletions. A precise
                // per-anchor delta is later (Phase 4) work.
                observer.didUpdate(items.map(WriteFileProviderItem.init))
                let anchor = (try? anchorResult.get())
                    .map { NSFileProviderSyncAnchor(Data($0.utf8)) } ?? syncAnchor
                observer.finishEnumeratingChanges(upTo: anchor, moreComing: false)
            case .failure(let error):
                observer.finishEnumeratingWithError(Self.bridge(error))
            }
        }
    }

    /// Map a sync error onto the File Provider error the system expects.
    static func bridge(_ error: WriteSyncError) -> NSError {
        switch error {
        case .notFound:
            return fp(.noSuchItem)
        case .conflict:
            // The base version was stale (412). The framework re-reads and
            // retries the edit against the current version.
            return fp(.serverUnreachable)
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
