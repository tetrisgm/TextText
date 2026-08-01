import FileProvider
import Foundation
import TextTextFileProviderKit
import TextTextFileProviderBridge

/// Enumerates the domain ROOT: the shared Data tree plus one folder per
/// workspace the app handed off. The root is the only container that spans
/// workspaces, so it lives in the
/// extension (the kit's per-workspace core never sees more than one). Membership
/// rarely changes, so change tracking fingerprints the actual mapped workspace
/// child set. Any difference expires it for a clean root re-list.
final class WorkspaceListEnumerator: NSObject, NSFileProviderEnumerator {
    private let descriptors: [FileProviderWorkspace]

    init(descriptors: [FileProviderWorkspace]) { self.descriptors = descriptors }

    func invalidate() {}

    func enumerateItems(
        for observer: any NSFileProviderEnumerationObserver,
        startingAt page: NSFileProviderPage
    ) {
        observer.didEnumerate(Self.items(descriptors).map(TextTextFileProviderItem.init))
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
        WorkspaceEnumerator.fingerprint(items(descriptors))
    }

    static func item(
        for handle: String, in descriptors: [FileProviderWorkspace]
    ) -> TextTextItem? {
        items(descriptors).first { $0.identifier == .workspace(handle) }
    }

    static func items(_ descriptors: [FileProviderWorkspace]) -> [TextTextItem] {
        TextTextFilename.disambiguate([TextTextCentralAttachments.dataContainerItem()] + descriptors.map {
            TextTextItemMapper.workspaceItem(handle: $0.handle, name: $0.name, readOnly: false)
        })
    }
}

/// The working set across every workspace: the union of each workspace core's
/// `workingSet`. Identifiers are handle-scoped, so concatenation never collides.
/// The anchor fingerprints the actual mapped files, not global cursors.
final class AggregateWorkingSetEnumerator: NSObject, NSFileProviderEnumerator {
    private let descriptors: [FileProviderWorkspace]
    private let apiFactory: (String) -> TextTextSyncAPI?

    init(descriptors: [FileProviderWorkspace], apiFactory: @escaping (String) -> TextTextSyncAPI?) {
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
            var all: [TextTextFileProviderItem] = []
            for descriptor in descriptors {
                guard let api = apiFactory(descriptor.handle) else { continue }
                let core = WorkspaceEnumerator(
                    api: api, handle: descriptor.handle, workspaceName: descriptor.name, readOnly: false)
                if case .success(let items) = await core.children(of: .workingSet) {
                    all.append(contentsOf: items.map(TextTextFileProviderItem.init))
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
        _ descriptors: [FileProviderWorkspace], _ apiFactory: (String) -> TextTextSyncAPI?
    ) async -> Data {
        var items: [TextTextItem] = []
        for descriptor in descriptors {
            guard let api = apiFactory(descriptor.handle) else { continue }
            let core = WorkspaceEnumerator(
                api: api, handle: descriptor.handle, workspaceName: descriptor.name, readOnly: false)
            if case .success(let workspaceItems) = await core.children(of: .workingSet) {
                items.append(contentsOf: workspaceItems)
            }
        }
        return WorkspaceEnumerator.fingerprint(items)
    }
}

/// An enumerator that lists nothing (the trash: TextText soft-deletes, and evicted
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
