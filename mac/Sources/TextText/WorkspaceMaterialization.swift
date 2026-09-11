import Foundation

/// The workspace materialization walk, extracted from AppDelegate so its
/// stopping rules can be tested without a File Provider mount.
///
/// It lives here because the walk it replaced had no stopping rules at all. A
/// pass was a lazy deep enumerator with no deadline, no work cap and no way to
/// be cancelled, and on 2026-09-11 one was measured still enumerating five
/// minutes after launch, blocked in getattrlistbulk on 0.2 s of CPU (see
/// docs/HANDOFF.md, "Cold launch, measured (2026-09-11)"). Nothing in the app
/// waits on the walk, so it never delayed first paint, but it held the File
/// Provider path and the network open through launch and long past it.
///
/// The cost is not the app's to spend freely: materializing one file makes the
/// extension re-resolve it, and `findFile` in WorkspaceEnumerator scans every
/// folder's manifest serially to do so, over an ephemeral session that caches
/// nothing. A file is therefore worth several round trips, not one, which is
/// why a pass is bounded by wall clock first and by counts only as a backstop.

/// One entry in a listed directory. A TextBundle is both a directory and a
/// package; `isPackage` wins, because a package materializes as a unit.
struct MaterializationEntry {
    let url: URL
    let isDirectory: Bool
    let isPackage: Bool
    let isRegularFile: Bool

    init(url: URL, isDirectory: Bool, isPackage: Bool, isRegularFile: Bool) {
        self.url = url
        self.isDirectory = isDirectory
        self.isPackage = isPackage
        self.isRegularFile = isRegularFile
    }
}

/// Everything the walk touches. A test supplies its own so the bounding rules
/// can be driven without a mount, and so a listing can be made to fail, which
/// is the case the retry exists for and the one a real mount will not stage on
/// demand.
protocol MaterializationFilesystem {
    /// List one directory. A failure has to stay a failure: the whole point of
    /// descending a directory at a time is that a folder which did not list is
    /// distinguishable from a folder which is empty.
    func listDirectory(_ url: URL) -> Result<[MaterializationEntry], any Error>

    /// Whether the item is still a dataless placeholder rather than content.
    func isDataless(_ url: URL) -> Bool

    /// Ask the system to download the item. Materialization is a side effect of
    /// reading, so this returns nothing; the caller re-checks `isDataless`.
    func download(_ url: URL, isPackage: Bool)
}

/// What a single pass is allowed to spend.
///
/// Wall clock is the real bound. The counts exist so that a link fast enough to
/// keep issuing work for the whole window still cannot queue an unbounded
/// amount of it, and so a test can exhaust a budget without waiting.
struct MaterializationBudget {
    var duration: TimeInterval
    var listings: Int
    var downloads: Int

    init(duration: TimeInterval, listings: Int, downloads: Int) {
        self.duration = duration
        self.listings = listings
        self.downloads = downloads
    }

    /// The shipping budget. Fifteen seconds is long enough to walk a warm tree
    /// out in one pass, because listing a directory that is already
    /// materialized never reaches the extension, and short enough that a cold
    /// tree on a slow link stops being this app's problem for the next six
    /// seconds rather than the next five minutes.
    static let standard = MaterializationBudget(
        duration: 15, listings: 500, downloads: 50)
}

/// Where a pass stopped and what the campaign has learned, so the next pass
/// resumes instead of starting over.
///
/// It holds directories rather than a position in an enumeration, because an
/// enumeration cannot be serialized and a directory can always be re-listed.
/// Re-listing is cheap once the directory is materialized: the File Provider
/// header is explicit that traversals of materialized directories, unlike
/// dataless ones, never reach the extension. So deferring a half-processed
/// directory costs a local listing, not a round trip.
///
/// It is campaign state, not process state. A campaign always starts a fresh
/// walk from the root, which is what the walk this replaced did on every
/// trigger, and it is what makes the walk self-healing: a folder that was
/// deleted or renamed simply stops being discovered, and files added remotely
/// since the last campaign are found. Carrying a position between campaigns
/// would save nothing worth having, because a warm tree re-lists locally and a
/// file that is already downloaded is no longer dataless.
struct MaterializationCursor {
    /// The mount this position is a position in. A re-registered domain can
    /// hand back a different user-visible URL, and paths from the old one name
    /// a tree that is gone, so the root travels with the cursor and the caller
    /// starts over when it does not match.
    let root: URL
    var pending: [URL]
    /// Files that were still dataless after this campaign asked for them. They
    /// are not asked for again until the next campaign, because a handful of
    /// files that never materialize would otherwise consume every pass's
    /// download budget and starve the rest of the workspace forever.
    var stubborn: Set<URL>
    /// Directories this campaign has already listed. Re-listing a directory
    /// that was abandoned part way rediscovers the subdirectories it queued the
    /// first time, and without this the queue would regrow them every pass.
    var visited: Set<URL>
    var sawLegacySidecar: Bool
    /// How many files this campaign has seen at all. A completed walk that
    /// found none is the cold-enumeration case: the old walk called that
    /// `files.isEmpty` and retried on it, and so does this.
    var filesSeen: Int

    init(
        root: URL, pending: [URL], stubborn: Set<URL> = [],
        visited: Set<URL> = [], sawLegacySidecar: Bool = false,
        filesSeen: Int = 0
    ) {
        self.root = root
        self.pending = pending
        self.stubborn = stubborn
        self.visited = visited
        self.sawLegacySidecar = sawLegacySidecar
        self.filesSeen = filesSeen
    }

    static func starting(at root: URL) -> MaterializationCursor {
        MaterializationCursor(root: root, pending: [root])
    }

    var isFinished: Bool { pending.isEmpty }

    /// The cursor to use for a pass over `root`: this one when it describes the
    /// same mount, a fresh walk when it does not.
    func resumed(at root: URL) -> MaterializationCursor {
        // Compared by path: URL equality also carries the trailing slash that
        // marks a directory, and the same mount spelled with and without one is
        // still the same mount.
        self.root.standardizedFileURL.path == root.standardizedFileURL.path
            ? self : .starting(at: root)
    }
}

/// What a pass did, and whether the caller should run another.
struct MaterializationOutcome {
    var cursor: MaterializationCursor
    var listed = 0
    var downloaded = 0
    var failedListings = 0
    var unclassified = 0
    var stoppedOnBudget = false
    var wasCancelled = false

    /// Files this campaign asked for that did not arrive.
    var stillDataless: Int { cursor.stubborn.count }

    /// Whether there is more to do.
    ///
    /// A cancelled pass reports nothing: it was abandoned because the domain
    /// changed underneath it, so what it saw describes a tree that no longer
    /// applies and its caller discards the result anyway.
    ///
    /// Everything else that can mean "not done" is named here rather than
    /// inferred from an empty file list, which is what the old walk did. A deep
    /// enumerator with no error handler continues silently past a directory it
    /// could not read, so a workspace where one folder timed out still produced
    /// files and looked complete, no retry ran, and those files stayed dataless.
    /// The one signal that walk did have, a whole tree that yielded no files at
    /// all, is kept as `filesSeen`.
    var incomplete: Bool {
        if wasCancelled { return false }
        return !cursor.isFinished
            || failedListings > 0
            || !cursor.stubborn.isEmpty
            || cursor.sawLegacySidecar
            || cursor.filesSeen == 0
    }
}

enum WorkspaceMaterialization {
    /// Walk what the cursor still owes, within the budget.
    ///
    /// Directories are listed one at a time rather than through a lazy deep
    /// enumerator. That is what the old comment here always claimed and what
    /// the code had stopped doing, and it buys the two properties this needs:
    /// a folder that failed to list is visible as a failure rather than as an
    /// absence, and the walk has a position that survives the end of a pass.
    static func runPass(
        cursor: MaterializationCursor,
        budget: MaterializationBudget,
        filesystem: any MaterializationFilesystem,
        now: () -> Date,
        isCancelled: () -> Bool
    ) -> MaterializationOutcome {
        var state = cursor
        var pending = cursor.pending
        // Directories this pass could not finish. They go back on the cursor at
        // the end rather than to the back of the queue, so one folder that
        // always fails cannot be re-listed until the budget is gone.
        var deferred: [URL] = []
        var outcome = MaterializationOutcome(cursor: cursor)
        let started = now()

        // Time and downloads can run out in the middle of a directory. The
        // listing count cannot: it decides whether to start another directory,
        // and is not consulted again once one is started, because a directory
        // abandoned immediately after being listed has spent the expensive part
        // and kept none of it.
        func outOfWork() -> Bool {
            now().timeIntervalSince(started) >= budget.duration
                || outcome.downloaded >= budget.downloads
        }

        while !pending.isEmpty {
            if isCancelled() {
                outcome.wasCancelled = true
                break
            }
            if outOfWork() || outcome.listed >= budget.listings {
                outcome.stoppedOnBudget = true
                break
            }
            let directory = pending.removeFirst()
            outcome.listed += 1

            let entries: [MaterializationEntry]
            switch filesystem.listDirectory(directory) {
            case .failure:
                // A cold enumeration right after a domain register can time out
                // and cache the folder as empty. Treating that as a failure is
                // the whole reason the retry exists.
                outcome.failedListings += 1
                deferred.append(directory)
                continue
            case .success(let listed):
                entries = listed
                state.visited.insert(directory)
            }

            // Queue every subdirectory before touching a single file, so what
            // the walk knows about the shape of the tree never depends on how
            // much download budget was left when the listing came back.
            for entry in entries where entry.isDirectory && !entry.isPackage {
                if entry.url.pathExtension.lowercased() == "assets" {
                    state.sawLegacySidecar = true
                }
                // A re-listed directory hands back subdirectories this campaign
                // has already walked. Owing them again would make the queue
                // regrow every time a directory is abandoned.
                if !state.visited.contains(entry.url) { pending.append(entry.url) }
            }

            var finishedDirectory = true
            for entry in entries where !(entry.isDirectory && !entry.isPackage) {
                if entry.url.pathExtension.lowercased() == "assets" {
                    state.sawLegacySidecar = true
                }
                if isCancelled() {
                    outcome.wasCancelled = true
                    finishedDirectory = false
                    break
                }
                guard entry.isPackage || entry.isRegularFile else {
                    // Neither a file nor a directory, or its attributes did not
                    // read. Counted rather than dropped in silence, because the
                    // mount is only supposed to publish files and folders and a
                    // third thing means something is wrong worth seeing.
                    outcome.unclassified += 1
                    continue
                }
                state.filesSeen += 1
                // Already asked for once this campaign and it did not arrive.
                // Asking again would spend the budget on the same failure.
                if state.stubborn.contains(entry.url) { continue }
                guard filesystem.isDataless(entry.url) else { continue }
                if outOfWork() {
                    outcome.stoppedOnBudget = true
                    finishedDirectory = false
                    break
                }
                outcome.downloaded += 1
                filesystem.download(entry.url, isPackage: entry.isPackage)
                if filesystem.isDataless(entry.url) {
                    state.stubborn.insert(entry.url)
                }
            }
            // A directory abandoned part way through is owed in full next pass.
            // Re-listing it is local once it is materialized, and the files it
            // already handed over are no longer dataless, so the repeat is
            // close to free.
            if !finishedDirectory { deferred.append(directory) }
            if outcome.wasCancelled { break }
        }

        // Re-listing an abandoned directory rediscovers the subdirectories it
        // already queued, so the same URL can be owed twice. Keep the first
        // occurrence and drop the rest, or the queue grows every pass.
        var seen: Set<URL> = []
        state.pending = (pending + deferred).filter { seen.insert($0).inserted }
        outcome.cursor = state
        return outcome
    }
}

/// Cancellation that a walk running on a background queue can read without
/// hopping to the main thread for it.
///
/// The epoch it mirrors is main-thread state, and the walk cannot ask for it
/// between listings without paying a hop per directory, so the epoch owns this
/// token and flips it instead.
final class MaterializationCancellation {
    private let lock = NSLock()
    private var cancelled = false

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }
}

/// The real mount.
struct LiveMaterializationFilesystem: MaterializationFilesystem {
    private let fileManager = FileManager.default
    private let coordinator = NSFileCoordinator()

    func listDirectory(_ url: URL) -> Result<[MaterializationEntry], any Error> {
        do {
            // Hidden files are skipped because a .DS_Store that Finder wrote
            // into a cold folder is content this app never has to download, and
            // because the old walk counted one as evidence the tree had listed.
            let urls = try fileManager.contentsOfDirectory(
                at: url,
                includingPropertiesForKeys: [
                    .isRegularFileKey, .isDirectoryKey, .isPackageKey,
                ],
                options: [.skipsHiddenFiles])
            return .success(urls.map { child in
                let values = try? child.resourceValues(forKeys: [
                    .isRegularFileKey, .isDirectoryKey, .isPackageKey,
                ])
                return MaterializationEntry(
                    url: child,
                    isDirectory: values?.isDirectory == true,
                    isPackage: values?.isPackage == true,
                    isRegularFile: values?.isRegularFile == true)
            })
        } catch {
            return .failure(error)
        }
    }

    /// Whether a File Provider item is still a dataless placeholder
    /// (SF_DATALESS in st_flags), i.e. its content has not been downloaded yet.
    func isDataless(_ url: URL) -> Bool {
        var status = stat()
        guard lstat(url.path, &status) == 0 else { return false }
        return (status.st_flags & UInt32(bitPattern: SF_DATALESS)) != 0
    }

    func download(_ url: URL, isPackage: Bool) {
        var error: NSError?
        coordinator.coordinate(
            readingItemAt: url,
            options: isPackage ? .forUploading : [],
            error: &error
        ) { readable in
            _ = try? Data(contentsOf: readable) // reading downloads it
        }
    }
}
