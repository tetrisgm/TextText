import CoreServices
import Foundation

public final class WorkspaceFolderWatcher {
    private var stream: FSEventStreamRef?
    private var metadataQuery: NSMetadataQuery?
    private var metadataObservers: [NSObjectProtocol] = []
    private let queue: DispatchQueue
    private let onChange: () -> Void
    private let rootPath: String
    public private(set) var fseventsStarted = false

    public init?(path: String, queue: DispatchQueue, includeUbiquitousItems: Bool = true, latency: CFTimeInterval = 1.0, onChange: @escaping () -> Void) {
        self.queue = queue
        self.onChange = onChange
        self.rootPath = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL.path
        let retainCallback: CFAllocatorRetainCallBack = { info in
            guard let info else { return nil }
            return UnsafeRawPointer(Unmanaged<WorkspaceFolderWatcher>.fromOpaque(info).retain().toOpaque())
        }
        let releaseCallback: CFAllocatorReleaseCallBack = { info in
            guard let info else { return }
            Unmanaged<WorkspaceFolderWatcher>.fromOpaque(info).release()
        }
        var context = FSEventStreamContext(
            version: 0,
            info: UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
            retain: retainCallback,
            release: releaseCallback,
            copyDescription: nil
        )
        let callback: FSEventStreamCallback = { _, info, count, eventPaths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<WorkspaceFolderWatcher>.fromOpaque(info).takeUnretainedValue()
            guard watcher.shouldHandle(eventPaths: eventPaths, count: count) else { return }
            watcher.onChange()
        }
        guard let stream = FSEventStreamCreate(
            nil,
            callback,
            &context,
            [self.rootPath] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            latency,
            FSEventStreamCreateFlags(
                kFSEventStreamCreateFlagNoDefer
                    | kFSEventStreamCreateFlagFileEvents
                    | kFSEventStreamCreateFlagWatchRoot
                    | kFSEventStreamCreateFlagUseCFTypes
            )
        ) else { return nil }
        FSEventStreamSetDispatchQueue(stream, queue)
        if FSEventStreamStart(stream) {
            self.stream = stream
            self.fseventsStarted = true
        } else {
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
        }

        if includeUbiquitousItems {
            startMetadataQuery(path: self.rootPath)
        }
    }

    public func stop() {
        if let metadataQuery {
            metadataQuery.stop()
            for observer in metadataObservers {
                NotificationCenter.default.removeObserver(observer)
            }
            metadataObservers.removeAll()
            self.metadataQuery = nil
        }
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    public func flush() {
        guard let stream else { return }
        FSEventStreamFlushSync(stream)
    }

    deinit {
        stop()
    }

    private func startMetadataQuery(path: String) {
        let query = NSMetadataQuery()
        query.searchScopes = [path]
        query.predicate = Self.metadataPredicate()
        let center = NotificationCenter.default
        let update = center.addObserver(forName: .NSMetadataQueryDidUpdate, object: query, queue: nil) { [weak self] _ in
            guard let self else { return }
            self.queue.async { self.onChange() }
        }
        let finish = center.addObserver(forName: .NSMetadataQueryDidFinishGathering, object: query, queue: nil) { [weak self] _ in
            guard let self else { return }
            self.queue.async { self.onChange() }
        }
        metadataObservers = [update, finish]
        metadataQuery = query
        if !query.start() {
            for observer in metadataObservers {
                center.removeObserver(observer)
            }
            metadataObservers.removeAll()
            metadataQuery = nil
        }
    }

    static func metadataPredicate() -> NSPredicate {
        NSPredicate(format: "%K LIKE[c] %@", NSMetadataItemFSNameKey, "*.md")
    }

    func shouldHandleEventPathsForTesting(_ paths: [String]) -> Bool {
        let array = paths as NSArray
        return shouldHandle(
            eventPaths: Unmanaged.passUnretained(array).toOpaque(),
            count: paths.count
        )
    }

    private func shouldHandle(eventPaths: UnsafeMutableRawPointer, count: Int) -> Bool {
        let array = unsafeBitCast(eventPaths, to: NSArray.self)
        let paths = array.compactMap { $0 as? String }
        if paths.isEmpty { return true }
        return paths.prefix(count).contains { !isInternalEventPath($0) }
    }

    private func isInternalEventPath(_ path: String) -> Bool {
        let normalized = URL(fileURLWithPath: path).standardizedFileURL.path
        guard normalized == rootPath || normalized.hasPrefix(rootPath + "/") else { return false }
        if normalized == rootPath { return false }
        let start = normalized.index(normalized.startIndex, offsetBy: rootPath.count + 1)
        let first = normalized[start...].split(separator: "/", omittingEmptySubsequences: true).first
        return first == Substring(WorkspaceLayout.metadataDirectoryName)
            || first == Substring(WorkspaceLayout.localMetadataDirectoryName)
    }
}
