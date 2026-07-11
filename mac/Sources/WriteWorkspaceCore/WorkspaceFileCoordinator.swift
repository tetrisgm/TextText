import Foundation

public enum ICloudMaterializationState: Equatable {
    case local
    case current
    case downloaded
    case notDownloaded
    case downloading
    case failed(String)
    case unknown
}

public final class WorkspaceFileCoordinator: NSObject, NSFilePresenter {
    public let rootURL: URL
    public let presentedItemOperationQueue = OperationQueue()
    public var onPresentedItemChange: (() -> Void)?

    public var presentedItemURL: URL? { rootURL }

    public init(rootURL: URL) {
        self.rootURL = rootURL
        presentedItemOperationQueue.name = "WriteWorkspaceFilePresenter"
        presentedItemOperationQueue.maxConcurrentOperationCount = 1
        super.init()
        NSFileCoordinator.addFilePresenter(self)
    }

    deinit {
        NSFileCoordinator.removeFilePresenter(self)
    }

    public func readData(at url: URL, materializeTimeout: TimeInterval = 1) throws -> Data {
        try materializeForRead(at: url, timeout: materializeTimeout)
        var result: Result<Data, Error> = .failure(CocoaError(.fileReadUnknown))
        var coordinationError: NSError?
        NSFileCoordinator(filePresenter: self).coordinate(readingItemAt: url, options: [], error: &coordinationError) { readURL in
            result = Result { try Data(contentsOf: readURL) }
        }
        if let coordinationError {
            if isLocalFilesystem(url) { return try Data(contentsOf: url) }
            throw coordinationError
        }
        do {
            return try result.get()
        } catch {
            if isLocalFilesystem(url) { return try Data(contentsOf: url) }
            throw error
        }
    }

    public func writeData(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var result: Result<Void, Error> = .success(())
        var coordinationError: NSError?
        let options: NSFileCoordinator.WritingOptions = .forReplacing
        NSFileCoordinator(filePresenter: self).coordinate(writingItemAt: url, options: options, error: &coordinationError) { writeURL in
            result = Result { try data.write(to: writeURL, options: .atomic) }
        }
        if let coordinationError {
            if isLocalFilesystem(url) {
                try data.write(to: url, options: .atomic)
                return
            }
            throw coordinationError
        }
        do {
            try result.get()
        } catch {
            if isLocalFilesystem(url) {
                try data.write(to: url, options: .atomic)
                return
            }
            throw error
        }
    }

    public func removeItem(at url: URL) throws {
        var result: Result<Void, Error> = .success(())
        var coordinationError: NSError?
        NSFileCoordinator(filePresenter: self).coordinate(writingItemAt: url, options: .forDeleting, error: &coordinationError) { deleteURL in
            result = Result { try FileManager.default.removeItem(at: deleteURL) }
        }
        if let coordinationError {
            if isLocalFilesystem(url) {
                try FileManager.default.removeItem(at: url)
                return
            }
            throw coordinationError
        }
        do {
            try result.get()
        } catch {
            if isLocalFilesystem(url) {
                try FileManager.default.removeItem(at: url)
                return
            }
            throw error
        }
    }

    public func moveItem(at source: URL, to destination: URL) throws {
        try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        var result: Result<Void, Error> = .success(())
        var coordinationError: NSError?
        let coordinator = NSFileCoordinator(filePresenter: self)
        coordinator.coordinate(
            writingItemAt: source,
            options: .forMoving,
            writingItemAt: destination,
            options: FileManager.default.fileExists(atPath: destination.path) ? .forReplacing : [],
            error: &coordinationError
        ) { sourceURL, destinationURL in
            result = Result {
                try FileManager.default.moveItem(at: sourceURL, to: destinationURL)
                coordinator.item(at: sourceURL, didMoveTo: destinationURL)
            }
        }
        if let coordinationError {
            if isLocalFilesystem(source) && isLocalFilesystem(destination) {
                try FileManager.default.moveItem(at: source, to: destination)
                return
            }
            throw coordinationError
        }
        do {
            try result.get()
        } catch {
            if isLocalFilesystem(source) && isLocalFilesystem(destination) {
                try FileManager.default.moveItem(at: source, to: destination)
                return
            }
            throw error
        }
    }

    public func materializationState(for url: URL) -> ICloudMaterializationState {
        do {
            let values = try url.resourceValues(forKeys: [
                .isUbiquitousItemKey,
                .ubiquitousItemDownloadingStatusKey,
                .ubiquitousItemIsDownloadingKey,
                .ubiquitousItemDownloadingErrorKey,
            ])
            guard values.isUbiquitousItem == true else { return .local }
            if let error = values.ubiquitousItemDownloadingError {
                return .failed(error.localizedDescription)
            }
            if values.ubiquitousItemIsDownloading == true { return .downloading }
            switch values.ubiquitousItemDownloadingStatus {
            case .current: return .current
            case .downloaded: return .downloaded
            case .notDownloaded: return .notDownloaded
            default: return .unknown
            }
        } catch {
            return .unknown
        }
    }

    private func isLocalFilesystem(_ url: URL) -> Bool {
        switch materializationState(for: url) {
        case .local:
            return true
        default:
            if !FileManager.default.fileExists(atPath: url.path) {
                let parent = url.deletingLastPathComponent()
                if parent.path != url.path, case .local = materializationState(for: parent) {
                    return true
                }
            }
            if url.path == rootURL.path || url.path.hasPrefix(rootURL.path + "/") {
                if case .local = materializationState(for: rootURL) { return true }
            }
            return false
        }
    }

    public func materializeForRead(at url: URL, timeout: TimeInterval = 30) throws {
        switch materializationState(for: url) {
        case .local, .current, .downloaded, .unknown:
            return
        case .failed(let message):
            throw CocoaError(.fileReadUnknown, userInfo: [NSLocalizedDescriptionKey: message])
        case .notDownloaded, .downloading:
            try FileManager.default.startDownloadingUbiquitousItem(at: url)
        }

        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            var fresh = URL(fileURLWithPath: url.path)
            fresh.removeCachedResourceValue(forKey: .ubiquitousItemDownloadingStatusKey)
            fresh.removeCachedResourceValue(forKey: .ubiquitousItemIsDownloadingKey)
            switch materializationState(for: fresh) {
            case .local, .current, .downloaded, .unknown:
                return
            case .failed(let message):
                throw CocoaError(.fileReadUnknown, userInfo: [NSLocalizedDescriptionKey: message])
            case .notDownloaded, .downloading:
                Thread.sleep(forTimeInterval: 0.05)
            }
        }
        throw CocoaError(.fileReadUnknown, userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for iCloud download"])
    }

    public func presentedItemDidChange() {
        onPresentedItemChange?()
    }

    public func presentedSubitemDidChange(at url: URL) {
        onPresentedItemChange?()
    }

    public func presentedItemDidMove(to newURL: URL) {
        onPresentedItemChange?()
    }

    public func accommodatePresentedItemDeletion(completionHandler: @escaping (Error?) -> Void) {
        onPresentedItemChange?()
        completionHandler(nil)
    }
}
