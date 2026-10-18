import Foundation
import Darwin
import TextTextWorkspaceCore

extension LocalVaultDocumentStore {
    public struct ReplacementRecoveryEntry: Sendable {
        public let id: String
        public let path: String
        public let itemId: String
        public let currentHash: String?
        public let currentPresent: Bool
        public let kind: String
        public let preparedHash: String
        public let displacedHash: String?
        public let captured: Bool
        public let resolutionBlocked: String?
        public let savedAt: String
        public let resolved: Bool
        public let sourcePath: String?
        public let sourcePresent: Bool?
        public let sourceHash: String?
    }
    private var replacements: ReplacementRecoveryRegistry { ReplacementRecoveryRegistry(root: root) }

    /// Explicit recovery inspection bypasses the normal-read fence and follows
    /// stable identity, never a filename winner among duplicate copies.
    private func replacementVisible(_ entry: ReplacementRecoveryRegistry.Entry) throws -> (Document, Data) {
        var found: (Document, Data)?
        let paths = try list()
        guard paths.count <= 20_000 else { throw Failure.tooLarge }
        for path in paths {
            let bytes: Data, document: Document
            do {
                bytes = try StableFileSnapshot.read(url(for: path))
                document = try parseDocument(path: path, bytes: bytes, preserveHistory: false)
            } catch { continue }
            guard MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == entry.itemId else { continue }
            guard found == nil else { throw Failure.duplicateIdentity }
            found = (document, bytes)
        }
        guard let found else { throw ReplacementRecoveryRegistry.Failure.unresolved(entry.operation) }
        return found
    }

    private func verifyMoveIdentityLocations(_ entry: ReplacementRecoveryRegistry.Entry) throws {
        guard entry.kind == "move", let destination = entry.destinationPath else { throw Failure.invalidPath }
        guard let rootPointer = realpath(root.path, nil) else { throw Failure.invalidPath }
        let physicalRoot = String(cString: rootPointer)
        free(rootPointer)
        var scanError: Error?
        guard let enumerator = FileManager.default.enumerator(at: root,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles, .skipsPackageDescendants],
            errorHandler: { _, error in scanError = error; return false }) else { throw Failure.invalidPath }
        var scanned = 0
        for case let candidate as URL in enumerator {
            scanned += 1
            guard scanned <= 100_000 else { throw Failure.tooLarge }
            let values = try candidate.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isSymbolicLink != true, let pointer = realpath(candidate.path, nil) else { throw Failure.invalidPath }
            let canonical = String(cString: pointer)
            free(pointer)
            guard canonical.hasPrefix(physicalRoot + "/") else { throw Failure.invalidPath }
            let relative = String(canonical.dropFirst(physicalRoot.count + 1))
            if relative == entry.path || relative == destination { enumerator.skipDescendants(); continue }
            guard values.isRegularFile == true, candidate.pathExtension.lowercased() == "textpack" else { continue }
            let bytes = try StableFileSnapshot.read(url(for: relative))
            let document = try parseDocument(path: relative, bytes: bytes, preserveHistory: false)
            guard MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId != entry.itemId else { throw Failure.duplicateIdentity }
        }
        if let scanError { throw scanError }
    }

    private func recoveryCurrent(_ entry: ReplacementRecoveryRegistry.Entry, inspectOnly: Bool = false, source: Bool = false) throws -> (document: Document?, data: Data?, path: String, resolutionBlocked: String?) {
        if entry.kind != "removal" && entry.kind != "move" {
            let (document, bytes) = try replacementVisible(entry)
            return (document, bytes, document.path, nil)
        }
        // The deletion pathname is authoritative, including a foreign or
        // malformed recreated file. Never substitute a matching identity found
        // elsewhere or follow a symlink to declare absence.
        let observedPath = entry.kind == "move" && !source ? entry.destinationPath! : entry.path
        let parts = observedPath.split(separator: "/")
        var location = root
        var missing = false
        for (index, part) in parts.enumerated() {
            location.appendPathComponent(String(part))
            if missing { continue }
            if entry.caseOnly == true, index == parts.count - 1, try !RetainedFileMove.exactLeafExists(location) { missing = true; continue }
            var info = stat()
            if lstat(location.path, &info) != 0 {
                guard errno == ENOENT else { throw Failure.invalidPath }
                missing = true; continue
            }
            guard info.st_mode & S_IFMT == (index == parts.count - 1 ? S_IFREG : S_IFDIR) else { throw Failure.invalidPath }
        }
        let paths = try list()
        guard paths.count < 20_000 else { throw Failure.tooLarge }
        var blocked: String?
        if entry.kind == "move" {
            do { try verifyMoveIdentityLocations(entry) }
            catch {
                guard inspectOnly else { throw error }
                blocked = "Another file location cannot be verified. Check the workspace before confirming recovery."
            }
        }
        for path in paths where path != observedPath {
            guard let bytes = try? StableFileSnapshot.read(url(for: path)),
                  let document = try? parseDocument(path: path, bytes: bytes, preserveHistory: false) else { continue }
            if MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId == entry.itemId {
                if entry.kind == "move", path == (source ? entry.destinationPath : entry.path) {
                    if !missing, let here = try? StableFileSnapshot.read(location),
                       let hereDocument = try? parseDocument(path: observedPath, bytes: here, preserveHistory: false),
                       MarkdownIdentityCodec.extract(from: hereDocument.contents.markdown)?.itemId == entry.itemId {
                        guard inspectOnly else { throw Failure.duplicateIdentity }
                        blocked = "This file exists at both move paths. Resolve its location before confirming recovery."
                    }
                    continue
                }
                guard inspectOnly else { throw Failure.duplicateIdentity }
                blocked = "This file also exists at another path. Resolve its location before confirming recovery."
            }
        }
        if missing { return (nil, nil, observedPath, blocked) }
        let bytes = try StableFileSnapshot.read(location)
        let document = try? parseDocument(path: observedPath, bytes: bytes, preserveHistory: false)
        return (document, bytes, observedPath, blocked)
    }

    func replacementRecoveryItemId(path: String) throws -> String? {
        for entry in try replacements.entries() {
            if try recoveryCurrent(entry, inspectOnly: true).path == path { return entry.itemId }
        }
        return nil
    }

    public func replacementRecoveryList() throws -> [ReplacementRecoveryEntry] {
        var result: [ReplacementRecoveryEntry] = []
        for entry in try replacements.entries() {
            let captured: Bool
            if entry.kind == "removal" || entry.kind == "move" { captured = try replacements.removalHasCapturedInode(entry) } else { captured = true }
            var resolved = entry.explicitCancellation != nil || entry.moveResolution != nil
            do {
                let readable = try replacements.isReadableWithoutMutation(entry)
                if readable {
                    if !captured && entry.explicitCancellation == nil && entry.moveResolution == nil { continue }
                    if entry.resolution != nil || entry.explicitCancellation != nil || entry.moveResolution != nil { resolved = true }
                    else if !(entry.kind == "removal" && entry.userDeletion == true && entry.deletionMarkerPublished != true && entry.deletionIntentCancelled != true) { continue }
                }
            } catch ReplacementRecoveryRegistry.Failure.unresolved { }
            let preparedHash: String, displacedHash: String?, directory: URL
            if captured {
                let inspection = try replacements.inspect(entry, persistRelocation: false)
                preparedHash = inspection.preparedHash; displacedHash = inspection.displacedHash; directory = inspection.recovery.directory
            } else {
                let inspection = try replacements.inspectUncaptured(entry)
                preparedHash = TextTextStableDigest.sha256Hex(inspection.prepared); displacedHash = nil; directory = inspection.recovery.directory
            }
            let current = try recoveryCurrent(entry, inspectOnly: true)
            let source = entry.kind == "move" ? try recoveryCurrent(entry, inspectOnly: true, source: true) : nil
            let values = try directory.resourceValues(forKeys: [.creationDateKey])
            result.append(ReplacementRecoveryEntry(id: entry.operation.uuidString, path: current.path, itemId: entry.itemId,
                currentHash: current.data.map(TextTextStableDigest.sha256Hex), currentPresent: current.data != nil, kind: entry.kind ?? "replacement", preparedHash: preparedHash, displacedHash: displacedHash,
                captured: captured, resolutionBlocked: current.resolutionBlocked,
                savedAt: ISO8601DateFormatter().string(from: values.creationDate ?? .distantPast), resolved: resolved,
                sourcePath: source?.path, sourcePresent: source.map { $0.data != nil }, sourceHash: source?.data.map(TextTextStableDigest.sha256Hex)))
        }
        return result
    }

    public func replacementRecoveryRead(id: String, version: String) throws -> (document: Document?, path: String, hash: String?, data: Data?, parseError: String?, absent: Bool) {
        guard let operation = UUID(uuidString: id), let entry = try replacements.entries().first(where: { $0.operation == operation }) else { throw Failure.invalidPath }
        let current = (version == "current" || (entry.kind == "move" && version == "source")) ? try recoveryCurrent(entry, inspectOnly: true, source: version == "source") : nil
        let path: String
        if let current { path = current.path }
        else if entry.kind == "move" { path = entry.destinationPath! }
        else if entry.kind == "removal" { path = entry.path }
        else { path = try replacementVisible(entry).0.path }
        let bytes: Data
        switch version {
        case "current", "source":
            guard version != "source" || entry.kind == "move" else { throw Failure.invalidPath }
            guard let data = current?.data else { return (nil, path, nil, nil, nil, true) }
            bytes = data
        case "prepared", "displaced":
            if entry.kind == "removal" || entry.kind == "move", try !replacements.removalHasCapturedInode(entry) {
                let inspection = try replacements.inspectUncaptured(entry)
                if version == "displaced" { return (nil, path, nil, nil, nil, true) }
                bytes = inspection.prepared
            } else {
                let inspection = try replacements.inspect(entry, persistRelocation: false)
                bytes = version == "prepared" ? inspection.prepared : inspection.displaced
            }
        default: throw Failure.invalidPath
        }
        let hash = TextTextStableDigest.sha256Hex(bytes)
        do {
            let document = try parseDocument(path: path, bytes: bytes, preserveHistory: false)
            let identity = MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId
            guard identity != nil, version == "displaced" || ((entry.kind == "removal" || entry.kind == "move") && (version == "current" || version == "source")) || identity == entry.itemId else { throw Failure.invalidPath }
            return (document, path, hash, bytes, nil, false)
        } catch {
            guard version == "displaced" || ((entry.kind == "removal" || entry.kind == "move") && (version == "current" || version == "source")) else { throw error }
            return (nil, path, hash, bytes, "This retained file cannot be opened as a TextPack.", false)
        }
    }

    public func cancelUncapturedDeletion(id: String, path: String, itemId: String, preparedHash: String,
                                        currentPresent: Bool, currentHash: String?, beforeAcknowledge: (() throws -> Void)? = nil) throws {
        guard let operation = UUID(uuidString: id), let entry = try replacements.entries(itemId: itemId).first(where: { $0.operation == operation }),
              entry.kind == "removal", entry.path == path else { throw Failure.invalidPath }
        var outcome: Result<Void, Error>?
        var coordinationError: NSError?
        let original = root.appendingPathComponent(path)
        NSFileCoordinator().coordinate(writingItemAt: original, options: [], error: &coordinationError) { _ in
            outcome = Result {
                let current = try recoveryCurrent(entry)
                let validate = {
                    let latest = try self.recoveryCurrent(entry)
                    guard (latest.data != nil) == currentPresent, latest.data.map(TextTextStableDigest.sha256Hex) == currentHash else { throw Failure.changed }
                }
                try validate()
                try replacements.cancelUncaptured(operation: operation, itemId: itemId, path: path, preparedHash: preparedHash,
                    current: current.data, validateCurrent: validate, beforeAcknowledge: beforeAcknowledge)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw CocoaError(.fileWriteUnknown) }
        try outcome.get()
    }

    public func resolveMove(id: String, path: String, sourcePath: String, itemId: String, preparedHash: String,
                            displacedHash: String?, captured: Bool, currentPresent: Bool, currentHash: String?,
                            sourcePresent: Bool, sourceHash: String?, beforeAcknowledge: (() throws -> Void)? = nil) throws {
        guard let operation = UUID(uuidString: id), let entry = try replacements.entries().first(where: { $0.operation == operation }),
              entry.kind == "move", entry.itemId == itemId, entry.path == sourcePath, entry.destinationPath == path else { throw Failure.invalidPath }
        let original = try recoveryCurrent(entry, source: true), current = try recoveryCurrent(entry)
        let validate = {
            let latestSource = try self.recoveryCurrent(entry, source: true), latestCurrent = try self.recoveryCurrent(entry)
            guard (latestSource.data != nil) == sourcePresent, latestSource.data.map(TextTextStableDigest.sha256Hex) == sourceHash,
                  (latestCurrent.data != nil) == currentPresent, latestCurrent.data.map(TextTextStableDigest.sha256Hex) == currentHash else { throw Failure.changed }
        }
        try validate()
        try replacements.resolveMove(operation: operation, observed: .init(preparedHash: preparedHash, displacedHash: displacedHash,
            captured: captured, currentHash: currentHash, currentPresent: currentPresent, sourceHash: sourceHash, sourcePresent: sourcePresent),
            current: current.data, source: original.data, validateCurrent: validate, beforeAcknowledge: beforeAcknowledge)
    }

    public func resolveReplacement(id: String, path: String, itemId: String, currentHash: String?, preparedHash: String, displacedHash: String?, kind: String = "replacement", currentPresent: Bool = true, beforeAcknowledge: (() throws -> Void)? = nil) throws {
        guard let displacedHash, let operation = UUID(uuidString: id), let entry = try replacements.entries().first(where: { $0.operation == operation }), entry.itemId == itemId else { throw Failure.invalidPath }
        let current = try recoveryCurrent(entry)
        guard (entry.kind ?? "replacement") == kind, current.path == path, (current.data != nil) == currentPresent, current.data.map(TextTextStableDigest.sha256Hex) == currentHash else { throw Failure.changed }
        try replacements.resolve(operation: operation, visible: root.appendingPathComponent(path), itemId: itemId,
            observed: .init(visibleHash: currentHash, preparedHash: preparedHash, displacedHash: displacedHash, currentPresent: currentPresent), beforeAcknowledge: beforeAcknowledge)
    }
}
