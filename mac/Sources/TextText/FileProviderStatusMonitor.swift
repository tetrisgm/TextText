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
        detail: "Link this Mac to add TextText to Finder.",
        severity: .neutral)

    static let checking = FileProviderStatusSnapshot(
        symbolName: "arrow.triangle.2.circlepath.icloud",
        title: "Checking Finder sync",
        detail: "Reading Finder's current sync state.",
        severity: .working)

    static func warning(_ error: Error) -> FileProviderStatusSnapshot {
        FileProviderStatusSnapshot(
            symbolName: "exclamationmark.icloud",
            title: "Finder sync needs attention",
            detail: error.localizedDescription,
            severity: .warning)
    }

    static func make(
        pendingCount: Int,
        uploadingFraction: Double? = nil,
        downloadingFraction: Double? = nil
    ) -> FileProviderStatusSnapshot {
        let transferDetail = [
            progressDescription(uploadingFraction, label: "Uploading"),
            progressDescription(downloadingFraction, label: "Downloading"),
        ].compactMap { $0 }.joined(separator: " · ")

        if pendingCount > 0 || !transferDetail.isEmpty {
            let noun = pendingCount == 1 ? "file" : "files"
            return FileProviderStatusSnapshot(
                symbolName: "arrow.triangle.2.circlepath.icloud",
                title: pendingCount > 0
                    ? "Syncing \(pendingCount) \(noun)"
                    : "Finder is syncing",
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

/// Samples a transient File Provider state for a short, fixed window. Health
/// reporting uses this to avoid treating the monitor's initial `checking` state
/// as a warning while still bounding how long genuine pending work can delay a
/// report. Neutral and error states are terminal and are never retried here.
struct FileProviderReadinessProbe {
    struct Result: Equatable {
        let snapshot: FileProviderStatusSnapshot
        let sampleCount: Int
        let startedWorking: Bool
        let becameHealthy: Bool
        let exhausted: Bool
    }

    let maximumSamples: Int
    let interval: TimeInterval
    private let wait: (TimeInterval) -> Void

    init(
        maximumSamples: Int = 11,
        interval: TimeInterval = 0.5,
        wait: @escaping (TimeInterval) -> Void = Thread.sleep(forTimeInterval:)
    ) {
        self.maximumSamples = max(1, maximumSamples)
        self.interval = max(0, interval)
        self.wait = wait
    }

    func run(
        statusProvider: () -> FileProviderStatusSnapshot
    ) -> Result {
        var snapshot = statusProvider()
        let startedWorking = snapshot.severity == .working
        var sampleCount = 1

        while snapshot.severity == .working, sampleCount < maximumSamples {
            wait(interval)
            snapshot = statusProvider()
            sampleCount += 1
        }

        return Result(
            snapshot: snapshot,
            sampleCount: sampleCount,
            startedWorking: startedWorking,
            becameHealthy: startedWorking && snapshot.severity == .healthy,
            exhausted: snapshot.severity == .working
                && sampleCount == maximumSamples)
    }
}

/// Reads File Provider's own pending set and global transfer progress. Finder is
/// the authority for these states, so the app reports the same truth instead of
/// maintaining a second, eventually inconsistent sync badge.
protocol FileProviderPendingEnumeration: AnyObject {
    func cancel()
}

protocol FileProviderStatusProviding: AnyObject {
    var uploadingProgress: Progress { get }
    var downloadingProgress: Progress { get }

    func enumeratePendingItems(
        completion: @escaping (Int, Error?) -> Void
    ) -> any FileProviderPendingEnumeration
}

final class SystemFileProviderStatusProvider: FileProviderStatusProviding {
    private let manager: NSFileProviderManager

    init?(_ domain: NSFileProviderDomain) {
        guard let manager = NSFileProviderManager(for: domain) else { return nil }
        self.manager = manager
    }

    var uploadingProgress: Progress {
        manager.globalProgress(for: .uploading)
    }

    var downloadingProgress: Progress {
        manager.globalProgress(for: .downloading)
    }

    func enumeratePendingItems(
        completion: @escaping (Int, Error?) -> Void
    ) -> any FileProviderPendingEnumeration {
        let enumerator = manager.enumeratorForPendingItems()
        let observer = PendingItemsObserver(
            enumerator: enumerator, completion: completion)
        enumerator.enumerateItems(
            for: observer, startingAt: NSFileProviderPage(Data()))
        return observer
    }
}

final class FileProviderStatusMonitor {
    var onChange: ((FileProviderStatusSnapshot) -> Void)?

    private(set) var snapshot = FileProviderStatusSnapshot.unavailable
    private let notificationCenter: NotificationCenter
    private let providerFactory:
        (NSFileProviderDomain) -> (any FileProviderStatusProviding)?
    private var provider: (any FileProviderStatusProviding)?
    private var boundDomainIdentifier: NSFileProviderDomainIdentifier?
    private var notificationToken: NSObjectProtocol?
    private var activeEnumeration: (any FileProviderPendingEnumeration)?
    private var refreshRequested = false
    private var generation = 0

    init(
        notificationCenter: NotificationCenter = .default,
        providerFactory: ((NSFileProviderDomain) ->
            (any FileProviderStatusProviding)?)? = nil
    ) {
        self.notificationCenter = notificationCenter
        self.providerFactory = providerFactory ?? {
            SystemFileProviderStatusProvider($0)
        }
        notificationToken = notificationCenter.addObserver(
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
            notificationCenter.removeObserver(notificationToken)
        }
    }

    func bind(to domain: NSFileProviderDomain) {
        precondition(Thread.isMainThread)
        if boundDomainIdentifier == domain.identifier, provider != nil {
            refresh()
            return
        }
        generation += 1
        activeEnumeration?.cancel()
        activeEnumeration = nil
        refreshRequested = false
        boundDomainIdentifier = domain.identifier
        provider = providerFactory(domain)
        guard provider != nil else {
            publish(.warning(NSError(
                domain: NSFileProviderErrorDomain,
                code: NSFileProviderError.providerNotFound.rawValue,
                userInfo: [NSLocalizedDescriptionKey:
                    "Finder's TextText provider is not available."])))
            return
        }
        publish(.checking)
        refresh()
    }

    func unbind() {
        precondition(Thread.isMainThread)
        generation += 1
        activeEnumeration?.cancel()
        activeEnumeration = nil
        refreshRequested = false
        provider = nil
        boundDomainIdentifier = nil
        publish(.unavailable)
    }

    func refresh() {
        if !Thread.isMainThread {
            DispatchQueue.main.async { [weak self] in self?.refresh() }
            return
        }
        guard let provider else {
            if boundDomainIdentifier == nil { publish(.unavailable) }
            return
        }
        guard activeEnumeration == nil else {
            refreshRequested = true
            return
        }

        generation += 1
        let requestGeneration = generation
        activeEnumeration = provider.enumeratePendingItems { [weak self] count, error in
            DispatchQueue.main.async {
                guard let self, self.generation == requestGeneration else { return }
                self.activeEnumeration = nil
                if self.refreshRequested {
                    self.refreshRequested = false
                    self.refresh()
                    return
                }
                if let error {
                    self.publish(.warning(error))
                    return
                }
                self.publish(FileProviderStatusSnapshot.make(
                    pendingCount: count,
                    uploadingFraction: self.activeFraction(
                        provider.uploadingProgress),
                    downloadingFraction: self.activeFraction(
                        provider.downloadingProgress)))
            }
        }
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

private enum PendingItemsObserverError: LocalizedError {
    case tooManyPages

    var errorDescription: String? {
        "Finder returned too many pending-item pages; sync status will retry."
    }
}

private final class PendingItemsObserver:
    NSObject, NSFileProviderEnumerationObserver, FileProviderPendingEnumeration
{
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
        if let nextPage {
            guard pages < 100 else {
                finished = true
                let finalCount = count
                lock.unlock()
                completion(finalCount, PendingItemsObserverError.tooManyPages)
                return
            }
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
