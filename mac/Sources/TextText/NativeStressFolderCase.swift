#if TEXTTEXT_STRESS_ACTOR
import Foundation
import Darwin
import CryptoKit
import TextTextFileProviderKit
import TextTextWorkspaceCore

// Read-only actor evidence, never a folder mutation or identity-based path search.
enum NativeStressFolderCase {
    static func observe(root: URL, itemId: String, title: String, relativePath: String, request: [String: Any]) throws -> (proof: [String: Any], pending: Bool) {
        func refuse() -> NSError { NSError(domain: "NativeStressFolderCase", code: 1, userInfo: [NSLocalizedDescriptionKey: "Owned folder observation is incomplete or changed."]) }
        guard Set(request.keys) == ["operationId", "phase", "scenario"], let operation = request["operationId"] as? String,
              operation.range(of: "^fc-[a-f0-9]{32}$", options: .regularExpression) != nil,
              let requested = request["phase"] as? String, ["before", "after"].contains(requested),
              let scenario = request["scenario"] as? [String: Any], Set(scenario.keys) == ["role", "round", "source", "destination", "emptyDescendants"],
              ["mac-cli", "pc-cli"].contains(scenario["role"] as? String ?? ""), (scenario["round"] as? Int) == 1,
              let source = scenario["source"] as? String, let destination = scenario["destination"] as? String,
              source != destination, source.lowercased() == destination.lowercased(),
              source.range(of: "^Six-client acceptance folder [a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$", options: [.regularExpression, .caseInsensitive]) != nil,
              let descendants = scenario["emptyDescendants"] as? [String], descendants.count <= 8, Set(descendants).count == descendants.count,
              descendants.allSatisfy({ !$0.isEmpty && $0.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { $0.range(of: "^[A-Za-z][A-Za-z0-9 -]{0,63}$", options: .regularExpression) != nil } }),
              title.hasPrefix("Six-client acceptance "), !title.contains("/") else { throw refuse() }
        guard [source + "/" + title + ".textpack", destination + "/" + title + ".textpack"].contains(relativePath) else { throw refuse() }
        for path in descendants { if let slash = path.lastIndex(of: "/"), !descendants.contains(String(path[..<slash])) { throw refuse() } }
        func stamp(_ url: URL) throws -> (String, String, mode_t) {
            var value = stat(); guard lstat(url.path, &value) == 0, value.st_mode & S_IFMT != S_IFLNK, value.st_ino > 0 else { throw refuse() }
            return ("\(value.st_dev):\(value.st_ino)", "\(value.st_dev):\(value.st_ino):\(value.st_size):\(value.st_mtimespec.tv_sec):\(value.st_mtimespec.tv_nsec):\(value.st_ctimespec.tv_sec):\(value.st_ctimespec.tv_nsec)", value.st_mode & S_IFMT)
        }
        let fm = FileManager.default, root = root.resolvingSymlinksInPath()
        let names = try fm.contentsOfDirectory(atPath: root.path)
        let pending = requested == "after" && !names.contains(destination) && names.contains(source)
        let phase = pending ? "before" : requested, name = phase == "before" ? source : destination, other = phase == "before" ? destination : source
        guard names.contains(name), !names.contains(other) else { throw refuse() }
        let directory = root.appendingPathComponent(name), initial = try stamp(directory)
        guard initial.2 == S_IFDIR else { throw refuse() }
        var folders = [String](), files = [String](), archiveHash: String?
        func scan(_ at: URL, _ prefix: String) throws {
            for leaf in try fm.contentsOfDirectory(atPath: at.path).sorted() {
                let relative = prefix.isEmpty ? leaf : prefix + "/" + leaf, url = at.appendingPathComponent(leaf), before = try stamp(url)
                if before.2 == S_IFDIR { guard descendants.contains(relative) else { throw refuse() }; folders.append(relative); try scan(url, relative) }
                else {
                    guard before.2 == S_IFREG, relative == title + ".textpack" else { throw refuse() }
                    let size = try fm.attributesOfItem(atPath: url.path)[.size] as? NSNumber
                    guard let size, size.intValue <= 64 * 1024 * 1024 else { throw refuse() }
                    let bytes = try Data(contentsOf: url)
                    guard bytes.count == size.intValue, try stamp(url).1 == before.1 else { throw refuse() }
                    let contents = try TextTextTextBundlePackage.read(from: url, in: fm.temporaryDirectory)
                    guard MarkdownIdentityCodec.extract(from: contents.markdown)?.itemId == itemId, try stamp(url).1 == before.1 else { throw refuse() }
                    archiveHash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(); files.append(relative)
                }
            }
        }
        try scan(directory, "")
        guard files == [title + ".textpack"], folders.sorted() == descendants.sorted(), try stamp(directory).1 == initial.1, let archiveHash else { throw refuse() }
        return (["version": 1, "kind": "filesystem", "operationId": operation, "phase": phase, "source": source, "destination": destination, "itemId": itemId, "relativePath": name + "/" + title + ".textpack", "folderIdentity": initial.0, "archiveSha256": archiveHash, "folders": ([name] + folders.map { name + "/" + $0 }).sorted()], pending)
    }
}
#endif
