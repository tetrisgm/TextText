import Foundation

/// Redirect only the Application Support lookup. All file creation, copying,
/// permissions and removal use FileManager's real implementations on owned URLs.
final class StateStoreTestFileManager: FileManager, @unchecked Sendable {
    let applicationSupport: URL
    private let queryLock = NSLock()
    private var queryCount = 0

    init(root: URL) {
        applicationSupport = root.appendingPathComponent("Application Support", isDirectory: true)
        super.init()
    }

    var applicationSupportQueryCount: Int {
        queryLock.lock(); defer { queryLock.unlock() }
        return queryCount
    }

    override func urls(for directory: FileManager.SearchPathDirectory, in domainMask: FileManager.SearchPathDomainMask) -> [URL] {
        if directory == .applicationSupportDirectory && domainMask == .userDomainMask {
            queryLock.lock(); queryCount += 1; queryLock.unlock()
            return [applicationSupport]
        }
        return super.urls(for: directory, in: domainMask)
    }
}
