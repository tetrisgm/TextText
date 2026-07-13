import FileProvider
import Foundation
import WriteFileProviderKit
import WriteFileProviderBridge

/// Enumerates the domain ROOT: one folder per workspace the app handed off. The
/// root is the only container that spans workspaces, so it lives in the
/// extension (the kit's per-workspace core never sees more than one). Membership
/// rarely changes, so change tracking is coarse: the anchor is a hash of the
/// handle+name set, and any difference expires it for a clean root re-list. The
/// name MUST be in the anchor: renaming a workspace keeps its handle, so a
/// name-only anchor would report "no changes" on signalEnumerator and the Finder
/// folder would keep the old name until a full domain re-registration (which, if
/// it read a still-stale handoff, would then strand the old name permanently).
final class WorkspaceListEnumerator: NSObject, NSFileProviderEnumerator {
    private let descriptors: [FileProviderWorkspace]

    init(descriptors: [FileProviderWorkspace]) { self.descriptors = descriptors }

    func invalidate() {}

    func enumerateItems(
        for observer: any NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        let items = descriptors.map {
            WriteFileProviderItem(WriteItemMapper.workspaceItem(
                handle: $0.handle, name: $0.name, readOnly: false))
        }
        observer.didEnumerate(items)
        observer.finishEnumerating(upTo: nil)
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        completionHandler(NSFileProviderSyncAnchor(Self.anchor(descriptors)))
    }

    func enumerateChanges(
        for observer: any NSFileProviderChangeObserver,
        from syncAnchor: NSFileProviderSyncAnchor
    ) {
        if syncAnchor.rawValue == Self.anchor(descriptors) {
            observer.finishEnumeratingChanges(upTo: syncAnchor, moreComing: false)
        } else {
            observer.finishEnumeratingWithError(NSError(
                domain: NSFileProviderErrorDomain,
                code: NSFileProviderError.syncAnchorExpired.rawValue))
        }
    }

    private static func anchor(_ descriptors: [FileProviderWorkspace]) -> Data {
        // handle AND name: a rename keeps the handle but must expire the anchor so
        // the root re-lists with the new folder name (see the type doc comment).
        Data(descriptors.map { "\($0.handle)=\($0.name)" }.sorted().joined(separator: "\n").utf8)
    }
}

/// The working set across every workspace: the union of each workspace core's
/// `everything()`. Identifiers are handle-scoped, so concatenation never
/// collides. The anchor combines the per-workspace cursors and expires on any
/// difference (the same deletion-correct full-reconcile the folder adapter uses).
final class AggregateWorkingSetEnumerator: NSObject, NSFileProviderEnumerator {
    private let descriptors: [FileProviderWorkspace]
    private let apiFactory: (String) -> WriteSyncAPI?

    init(descriptors: [FileProviderWorkspace], apiFactory: @escaping (String) -> WriteSyncAPI?) {
        self.descriptors = descriptors
        self.apiFactory = apiFactory
    }

    func invalidate() {}

    func enumerateItems(
        for observer: any NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        let descriptors = self.descriptors
        let apiFactory = self.apiFactory
        Task {
            var all: [WriteFileProviderItem] = []
            for descriptor in descriptors {
                guard let api = apiFactory(descriptor.handle) else { continue }
                let core = WorkspaceEnumerator(
                    api: api, handle: descriptor.handle, workspaceName: descriptor.name, readOnly: false)
                if case .success(let items) = await core.children(of: .workingSet) {
                    all.append(contentsOf: items.map(WriteFileProviderItem.init))
                }
            }
            observer.didEnumerate(all)
            observer.finishEnumerating(upTo: nil)
        }
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        let descriptors = self.descriptors
        let apiFactory = self.apiFactory
        Task { completionHandler(NSFileProviderSyncAnchor(await Self.anchor(descriptors, apiFactory))) }
    }

    func enumerateChanges(
        for observer: any NSFileProviderChangeObserver,
        from syncAnchor: NSFileProviderSyncAnchor
    ) {
        let descriptors = self.descriptors
        let apiFactory = self.apiFactory
        Task {
            let current = await Self.anchor(descriptors, apiFactory)
            if syncAnchor.rawValue == current {
                observer.finishEnumeratingChanges(upTo: syncAnchor, moreComing: false)
            } else {
                observer.finishEnumeratingWithError(NSError(
                    domain: NSFileProviderErrorDomain,
                    code: NSFileProviderError.syncAnchorExpired.rawValue))
            }
        }
    }

    private static func anchor(
        _ descriptors: [FileProviderWorkspace], _ apiFactory: (String) -> WriteSyncAPI?
    ) async -> Data {
        var parts: [String] = []
        for descriptor in descriptors {
            guard let api = apiFactory(descriptor.handle) else { continue }
            let core = WorkspaceEnumerator(
                api: api, handle: descriptor.handle, workspaceName: descriptor.name, readOnly: false)
            if case .success(let cursor) = await core.currentCursor() {
                parts.append(descriptor.handle + "=" + cursor)
            }
        }
        return Data(parts.sorted().joined(separator: "\n").utf8)
    }
}

/// An enumerator that lists nothing (the trash: Write soft-deletes, and evicted
/// items are not surfaced yet).
final class EmptyEnumerator: NSObject, NSFileProviderEnumerator {
    func invalidate() {}

    func enumerateItems(
        for observer: any NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        observer.finishEnumerating(upTo: nil)
    }

    func enumerateChanges(
        for observer: any NSFileProviderChangeObserver,
        from syncAnchor: NSFileProviderSyncAnchor
    ) {
        observer.finishEnumeratingChanges(upTo: syncAnchor, moreComing: false)
    }

    func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
        completionHandler(NSFileProviderSyncAnchor(Data()))
    }
}
