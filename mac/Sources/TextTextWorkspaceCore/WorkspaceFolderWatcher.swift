import CoreServices
import Foundation

public final class WorkspaceFolderWatcher {
    private static let ignoredTopLevelDirectories: Set<Substring> = [
        ".texttext",
        ".texttext-local.nosync",
    ]
    private var stream: FSEventStreamRef?
    private let onChange: () -> Void
    private let rootPath: String
    public private(set) var fseventsStarted = false

    public init?(path: String, queue: DispatchQueue, latency: CFTimeInterval = 1.0, onChange: @escaping () -> Void) {
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
    }

    public func stop() {
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
        return first.map(Self.ignoredTopLevelDirectories.contains) ?? false
    }
}
