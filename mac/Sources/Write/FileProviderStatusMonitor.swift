import FileProvider
import Foundation

struct FileProviderStatusSnapshot: Equatable {
    enum Severity: Equatable {
        case neutral
        case healthy
        case working
        case warning
    }

    var symbolName: String
    var title: String
    var detail: String
    var severity: Severity

    static let unavailable = FileProviderStatusSnapshot(
        symbolName: "icloud.slash",
        title: "Finder sync is not connected",
        detail: "Link this Mac to add Write to Finder.",
        severity: .neutral)

    static func make(
        pendingCount: Int,
        uploadingFraction: Double? = nil,
        downloadingFraction: Double? = nil
    ) -> FileProviderStatusSnapshot {
        let transferDetail = [
            progressDescription(uploadingFraction, label: "Uploading"),
            progressDescription(downloadingFraction, label: "Downloading"),
        ].compactMap { $0 }.joined(separator: " · ")

        if pendingCount > 0 {
            let noun = pendingCount == 1 ? "file" : "files"
            return FileProviderStatusSnapshot(
                symbolName: "arrow.triangle.2.circlepath.icloud",
                title: "Syncing \(pendingCount) \(noun)",
                detail: transferDetail.isEmpty
                    ? "All Markdown remains available locally."
                    : transferDetail + ". All Markdown remains available locally.",
                severity: .working)
        }

        return FileProviderStatusSnapshot(
            symbolName: "checkmark.icloud",
            title: "Finder is up to date",
            detail: "All Markdown is downloaded and kept on this Mac.",
            severity: .healthy)
    }

    private static func progressDescription(_ fraction: Double?, label: String) -> String? {
        guard let fraction, fraction.isFinite, fraction >= 0, fraction < 1 else { return nil }
        let percent = Int((fraction * 100).rounded())
        return "\(label) \(min(max(percent, 0), 100))%"
    }
}

/// Reads File Provider's own pending set and global transfer progress. Finder is
/// the authority for these states, so the app reports the same truth instead of
/// maintaining a second, eventually inconsistent sync badge.
final class FileProviderStatusMonitor {
    var onChange: ((FileProviderStatusSnapshot) -> Void)?

    private(set) var snapshot = FileProviderStatusSnapshot.unavailable
    private var manager: NSFileProviderManager?
    private var notificationToken: NSObjectProtocol?
    private var activeEnumeration: PendingItemsObserver?
    private var generation = 0

    init() {
        notificationToken = NotificationCenter.default.addObserver(
            forName: .fileProviderPendingSetDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.refresh()
        }
    }

    deinit {
        activeEnumeration?.cancel()
        if let notificationToken {
            NotificationCenter.default.removeObserver(notificationToken)
        }
    }

    func bind(to domain: NSFileProviderDomain) {
        precondition(Thread.isMainThread)
        generation += 1
        activeEnumeration?.cancel()
        activeEnumeration = nil
        manager = NSFileProviderManager(for: domain)
        refresh()
    }

    func unbind() {
        precondition(Thread.isMainThread)
        generation += 1
        activeEnumeration?.cancel()
        activeEnumeration = nil
        manager = nil
        publish(.unavailable)
    }

    func refresh() {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.refresh() }
            return
        }
        guard let manager else {
            publish(.unavailable)
            return
        }

        generation += 1
        let requestGeneration = generation
        activeEnumeration?.cancel()
        let enumerator = manager.enumeratorForPendingItems()
        let observer = PendingItemsObserver(enumerator: enumerator) { [weak self] count, error in
            DispatchQueue.main.async {
                guard let self, self.generation == requestGeneration else { return }
                self.activeEnumeration = nil
                if let error {
                    self.publish(FileProviderStatusSnapshot(
                        symbolName: "exclamationmark.icloud",
                        title: "Finder sync needs attention",
                        detail: error.localizedDescription,
                        severity: .warning))
                    return
                }
                self.publish(FileProviderStatusSnapshot.make(
                    pendingCount: count,
                    uploadingFraction: self.activeFraction(manager.globalProgress(for: .uploading)),
                    downloadingFraction: self.activeFraction(manager.globalProgress(for: .downloading))))
            }
        }
        activeEnumeration = observer
        enumerator.enumerateItems(for: observer, startingAt: NSFileProviderPage(Data()))
    }

    private func activeFraction(_ progress: Progress) -> Double? {
        guard !progress.isCancelled,
              progress.totalUnitCount > 0,
              progress.completedUnitCount < progress.totalUnitCount else { return nil }
        return progress.fractionCompleted
    }

    private func publish(_ value: FileProviderStatusSnapshot) {
        guard value != snapshot else { return }
        snapshot = value
        onChange?(value)
    }
}

private final class PendingItemsObserver: NSObject, NSFileProviderEnumerationObserver {
    private let enumerator: any NSFileProviderEnumerator
    private let completion: (Int, Error?) -> Void
    private let lock = NSLock()
    private var count = 0
    private var pages = 0
    private var finished = false

    init(
        enumerator: any NSFileProviderEnumerator,
        completion: @escaping (Int, Error?) -> Void
    ) {
        self.enumerator = enumerator
        self.completion = completion
    }

    func cancel() {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        lock.unlock()
        enumerator.invalidate()
    }

    func didEnumerate(_ updatedItems: [any NSFileProviderItem]) {
        lock.lock()
        defer { lock.unlock() }
        guard !finished else { return }
        count += updatedItems.count
    }

    func finishEnumerating(upTo nextPage: NSFileProviderPage?) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        pages += 1
        if let nextPage, pages < 100 {
            lock.unlock()
            enumerator.enumerateItems(for: self, startingAt: nextPage)
            return
        }
        finished = true
        let finalCount = count
        lock.unlock()
        completion(finalCount, nil)
    }

    func finishEnumeratingWithError(_ error: any Error) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        let finalCount = count
        lock.unlock()
        completion(finalCount, error)
    }
}
