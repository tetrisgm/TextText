#if TEXTTEXT_STRESS_ACTOR
import Foundation
import Darwin
import CryptoKit
import ZIPFoundation
import JavaScriptCore
import TextTextFileProviderKit
import TextTextWorkspaceCore

// Read-only, fixture-scoped filesystem evidence. No rename or expected-path substitution.
enum NativeStressLeafMove {
    struct Scenario: Decodable, Equatable {
        let role: String
        let round: Int
        let source: String
        let destination: String
        private enum Keys: String, CodingKey { case role, round, source, destination }
        init(from decoder: Decoder) throws {
            let raw = try decoder.container(keyedBy: AnyKey.self)
            guard Set(raw.allKeys.map(\.stringValue)) == ["role", "round", "source", "destination"] else { throw refusal() }
            let values = try decoder.container(keyedBy: Keys.self)
            role = try values.decode(String.self, forKey: .role); round = try values.decode(Int.self, forKey: .round)
            source = try values.decode(String.self, forKey: .source); destination = try values.decode(String.self, forKey: .destination)
            try validate()
        }
        struct AnyKey: CodingKey { let stringValue: String; var intValue: Int? { nil }; init?(stringValue: String) { self.stringValue = stringValue }; init?(intValue: Int) { return nil } }
        func validate() throws {
            let a = source.split(separator: "/", omittingEmptySubsequences: false).map(String.init), b = destination.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            let folder = "^Six-client acceptance folder [a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$", leaf = "^Six-client acceptance [A-Za-z0-9 -]{1,160}\\.textpack$"
            guard ["mac-cli", "pc-cli"].contains(role), round == 1, a.count == 2, b.count == 2, a[0] == b[0],
                  a[0].range(of: folder, options: .regularExpression) != nil,
                  a[1].range(of: leaf, options: .regularExpression) != nil, b[1].range(of: leaf, options: .regularExpression) != nil,
                  source.precomposedStringWithCanonicalMapping.lowercased() != destination.precomposedStringWithCanonicalMapping.lowercased() else { throw refusal() }
        }
        func qualifies(title: String, relativePath: String) -> Bool {
            source.split(separator: "/").last.map(String.init) == title + ".textpack" && [source, destination].contains(relativePath)
        }
    }
    static func refusal() -> NSError { NSError(domain: "NativeStressLeafMove", code: 1, userInfo: [NSLocalizedDescriptionKey: "The dedicated leaf move observation changed or is incomplete."]) }
    private static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func canonicalDocument(_ data: Data) throws -> Data {
        // Match the coordinator's ECMAScript number/string/key serialization.
        // Only this fixed function is evaluated; document bytes are an argument.
        guard let raw = String(data: data, encoding: .utf8), let context = JSContext(),
              let function = context.evaluateScript("(raw=>{const canonical=v=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))]))):v);return canonical(JSON.parse(raw));})"),
              let value = function.call(withArguments: [raw]), !value.isUndefined, context.exception == nil,
              let canonical = value.toString(), canonical.utf8.count <= 64 * 1024 * 1024 else { throw refusal() }
        return Data(canonical.utf8)
    }
    static func validateSnapshot(_ data: Data, title: String) throws {
        guard let snapshot = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = snapshot["schemaVersion"] as? NSNumber, String(cString: version.objCType) != "c", version.doubleValue == 1,
              let content = snapshot["content"] as? [String: Any], content["title"] as? String == title, content["body"] is String else { throw refusal() }
    }
    private static func stamp(_ url: URL) throws -> (id: String, key: String, type: mode_t, links: nlink_t, size: Int64) {
        var s = stat(); guard lstat(url.path, &s) == 0, s.st_mode & S_IFMT != S_IFLNK, s.st_ino > 0 else { throw refusal() }
        return ("\(s.st_dev):\(s.st_ino)", "\(s.st_dev):\(s.st_ino):\(s.st_size):\(s.st_mtimespec.tv_sec):\(s.st_mtimespec.tv_nsec):\(s.st_ctimespec.tv_sec):\(s.st_ctimespec.tv_nsec)", s.st_mode & S_IFMT, s.st_nlink, s.st_size)
    }
    private static func uniqueWorkspacePath(root: URL, itemId: String, expected: String) throws {
        var count = 0, bytes: Int64 = 0, matches = [String]()
        func scan(_ directory: URL, _ prefix: String) throws {
            let initial = try stamp(directory)
            guard initial.type == S_IFDIR else { throw refusal() }
            for name in try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted() {
                if prefix.isEmpty && name == ".texttext" { continue }
                count += 1; guard count <= 10_000 else { throw refusal() }
                let path = prefix.isEmpty ? name : prefix + "/" + name, url = directory.appendingPathComponent(name), before = try stamp(url)
                if before.type == S_IFDIR { try scan(url, path) }
                else if url.pathExtension.lowercased() == "textpack" {
                    bytes += before.size
                    guard before.type == S_IFREG, before.links == 1, before.size > 0, before.size <= 64 * 1024 * 1024, bytes <= 256 * 1024 * 1024 else { throw refusal() }
                    let contents = try TextTextTextBundlePackage.read(from: url, in: FileManager.default.temporaryDirectory)
                    guard let identity = MarkdownIdentityCodec.extract(from: contents.markdown)?.itemId, !identity.isEmpty,
                          try stamp(url).key == before.key else { throw refusal() }
                    if identity == itemId { matches.append(path) }
                }
            }
            guard try stamp(directory).key == initial.key else { throw refusal() }
        }
        try scan(root, "")
        guard matches == [expected] else { throw refusal() }
    }
    static func observe(root: URL, workspaceId: String, itemId: String, title: String, relativePath: String, configured: Scenario?, selectedItemId: String, selectedPath: String, request: [String: Any]) throws -> (proof: [String: Any], pending: Bool) {
        guard Set(request.keys) == ["version", "operationId", "phase", "scenario"],
              let version = request["version"] as? NSNumber, String(cString: version.objCType) != "c", version.doubleValue == 1,
              let operation = request["operationId"] as? String, operation.range(of: "^lm-[a-f0-9]{32}$", options: .regularExpression) != nil,
              let requested = request["phase"] as? String, ["before", "after"].contains(requested),
              let raw = request["scenario"] as? [String: Any] else { throw refusal() }
        let scenario = try JSONDecoder().decode(Scenario.self, from: JSONSerialization.data(withJSONObject: raw))
        guard scenario == configured, scenario.qualifies(title: title, relativePath: relativePath), selectedItemId == itemId,
              [scenario.source, scenario.destination].contains(selectedPath) else { throw refusal() }
        let fm = FileManager.default, root = root.standardizedFileURL.resolvingSymlinksInPath()
        let parentName = String(scenario.source.split(separator: "/")[0]), sourceLeaf = String(scenario.source.split(separator: "/")[1]), destinationLeaf = String(scenario.destination.split(separator: "/")[1])
        guard try fm.contentsOfDirectory(atPath: root.path).contains(parentName) else { throw refusal() }
        let parent = root.appendingPathComponent(parentName), parentBefore = try stamp(parent)
        guard parentBefore.type == S_IFDIR else { throw refusal() }
        let names = try fm.contentsOfDirectory(atPath: parent.path)
        guard names.count == 1, let leaf = names.first, [sourceLeaf, destinationLeaf].contains(leaf) else { throw refusal() }
        let phase = leaf == sourceLeaf ? "before" : "after"
        guard requested == "after" || phase == "before" else { throw refusal() }
        let path = parentName + "/" + leaf, url = parent.appendingPathComponent(leaf), before = try stamp(url)
        try uniqueWorkspacePath(root: root, itemId: itemId, expected: path)
        guard before.type == S_IFREG, before.links == 1, before.size > 0, before.size <= 64 * 1024 * 1024 else { throw refusal() }
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw refusal() }
        defer { close(fd) }
        var opened = stat(); guard fstat(fd, &opened) == 0, "\(opened.st_dev):\(opened.st_ino)" == before.id,
              opened.st_mode & S_IFMT == S_IFREG, opened.st_nlink == 1, opened.st_size == before.size else { throw refusal() }
        let bytes = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).readToEnd() ?? Data(), archive = try Archive(data: bytes, accessMode: .read)
        var entries: [String: Data] = [:], total: UInt64 = 0, count = 0
        for entry in archive {
            count += 1; total += entry.uncompressedSize
            let normalized = entry.path.hasSuffix("/") ? String(entry.path.dropLast()) : entry.path
            let components = normalized.split(separator: "/", omittingEmptySubsequences: false)
            guard count <= 10_000, total <= 64 * 1024 * 1024, entries[entry.path] == nil, entry.type != .symlink,
                  !entry.path.hasPrefix("/"), !entry.path.contains("\\"), !components.contains(""), !components.contains(".."), !components.contains(".") else { throw refusal() }
            var data = Data(); let checksum = try archive.extract(entry) { data.append($0) }
            guard data.count == entry.uncompressedSize, checksum == entry.checksum else { throw refusal() }
            entries[entry.path] = data
        }
        let roots = entries.keys.filter { $0 == "text.md" || $0.range(of: "^[^/]+/text\\.md$", options: .regularExpression) != nil }.map { String($0.dropLast(7)) }.filter { entries[$0 + "document.json"] != nil }
        guard roots.count == 1, let prefix = roots.first, let markdown = entries[prefix + "text.md"], let text = String(data: markdown, encoding: .utf8),
              MarkdownIdentityCodec.extract(from: text)?.itemId == itemId,
              let document = entries[prefix + "document.json"] else { throw refusal() }
        try validateSnapshot(document, title: title)
        let assets = entries.filter { $0.key.hasPrefix(prefix + "assets/") && !$0.key.hasSuffix("/") }
        guard (1...32).contains(assets.count) else { throw refusal() }
        let assetHashes = Dictionary(uniqueKeysWithValues: assets.map { (String($0.key.dropFirst(prefix.count)), hash($0.value)) })
        let canonical = try canonicalDocument(document)
        guard bytes.count == before.size, try stamp(url).key == before.key, try stamp(parent).key == parentBefore.key else { throw refusal() }
        let proof: [String: Any] = ["version": 1, "kind": "filesystem", "operationId": operation, "phase": phase, "workspaceId": workspaceId, "itemId": itemId,
            "source": scenario.source, "destination": scenario.destination, "relativePath": path, "sourcePresent": phase == "before", "destinationPresent": phase == "after",
            "fileIdentity": before.id, "archiveSha256": hash(bytes), "documentSha256": hash(canonical), "assetHashes": assetHashes, "selectedItemId": selectedItemId, "selectedPath": selectedPath]
        return (proof, requested == "after" && (phase == "before" || selectedPath != path))
    }
}
#endif
