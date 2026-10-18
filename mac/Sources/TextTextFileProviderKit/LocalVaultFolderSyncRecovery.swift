import Foundation
import Darwin
import TextTextWorkspaceCore

public struct LocalVaultFolderCaseServerRecovery: Codable, Sendable {
    public let state: String, requestHash: String
    public let operationId: String?, source: String?, destination: String?, inspection: String?, manifestRevision: String?
    public let folders: [String]?, items: [LocalVaultFolderCaseItem]?, result: LocalVaultFolderCaseReceipt?
}
public struct LocalVaultFolderSyncEndpoint: Sendable { public let present: Bool; public let identity: String? }
public struct LocalVaultFolderSyncRecoveryEntry: Sendable {
    public let id: String, command: LocalVaultFolderCaseRequest, state: String, expectedIdentity: String
    public let requestHash: String?, from: LocalVaultFolderSyncEndpoint, to: LocalVaultFolderSyncEndpoint
    public let localInspection: String, inspection: String?, manifestRevision: String?
    public let folders: [String]?, items: [LocalVaultFolderCaseItem]?, result: LocalVaultFolderCaseReceipt?, resolutionBlocked: String?
}

extension LocalVaultFolderCaseSync {
    struct Inspection {
        let from: LocalVaultFolderSyncEndpoint, to: LocalVaultFolderSyncEndpoint
        let digest: String, blocked: String?
    }
    static func inspect(root: URL, command: Command) throws -> Inspection {
        var records: [[String: Any]] = [], blocked: String?, bytesRead: Int64 = 0, count = 0
        func endpoint(_ path: String) throws -> LocalVaultFolderSyncEndpoint {
            guard try RetainedFileMove.exactRelativeExists(root: root, path: path) else { return .init(present: false, identity: nil) }
            var info = stat(); guard lstat(root.appendingPathComponent(path).path, &info) == 0 else { throw LocalVaultSyncFailure.changed }
            return .init(present: true, identity: info.st_mode & S_IFMT == S_IFDIR ? "mac:\(info.st_dev):\(info.st_ino)" : nil)
        }
        let from = try endpoint(command.request.source), to = try endpoint(command.request.destination)
        func walk(_ path: String) throws {
            count += 1; guard count <= 60_000 else { throw LocalVaultSyncFailure.invalidResponse }
            let url = root.appendingPathComponent(path); var info = stat()
            guard lstat(url.path, &info) == 0 else { throw LocalVaultSyncFailure.changed }
            var record: [String: Any] = ["path": path, "device": String(info.st_dev), "inode": String(info.st_ino), "mode": Int(info.st_mode), "size": String(info.st_size), "modified": "\(info.st_mtimespec.tv_sec):\(info.st_mtimespec.tv_nsec)"]
            if info.st_mode & S_IFMT == S_IFDIR {
                _ = try identity(root: root, path: path); records.append(record)
                for name in try FileManager.default.contentsOfDirectory(atPath: url.path).sorted() { try walk(path + "/" + name) }
            } else if info.st_mode & S_IFMT == S_IFREG {
                bytesRead += info.st_size
                guard info.st_size >= 0, info.st_size <= 64 * 1024 * 1024, bytesRead <= 128 * 1024 * 1024 else { throw LocalVaultSyncFailure.invalidResponse }
                record["hash"] = TextTextStableDigest.sha256Hex(try StableFileSnapshot.read(url, maximumBytes: 64 * 1024 * 1024)); records.append(record)
            } else { record["unsupported"] = true; records.append(record); throw LocalVaultSyncFailure.changed }
        }
        for (path, endpoint) in [(command.request.source, from), (command.request.destination, to)] where endpoint.present {
            do { try walk(path) } catch { blocked = "Some local folder entries could not be safely inspected. Keep all files and inspect them before continuing." }
        }
        let commandData = try JSONEncoder().encode(command.request)
        let commandObject = try JSONSerialization.jsonObject(with: commandData)
        let proof: [String: Any] = ["rootHash": command.rootHash, "accountId": command.accountId, "command": commandObject, "expectedDevice": String(command.identity.device), "expectedInode": String(command.identity.inode), "from": ["present": from.present, "identity": from.identity as Any? ?? NSNull()], "to": ["present": to.present, "identity": to.identity as Any? ?? NSNull()], "records": records, "blocked": blocked as Any? ?? NSNull()]
        return .init(from: from, to: to, digest: TextTextStableDigest.sha256Hex(try JSONSerialization.data(withJSONObject: proof, options: .sortedKeys)), blocked: blocked)
    }
    static func validateRecovery(_ value: LocalVaultFolderCaseServerRecovery, command: LocalVaultFolderCaseRequest, root: URL) throws {
        guard digest(value.requestHash) else { throw LocalVaultSyncFailure.invalidResponse }
        switch value.state {
        case "completed":
            guard let result = value.result, value.operationId == nil, value.source == nil, value.destination == nil, value.inspection == nil, value.manifestRevision == nil, value.folders == nil, value.items == nil else { throw LocalVaultSyncFailure.invalidResponse }
            try validateReceipt(result, command: command)
        case "review", "cancelled":
            guard value.operationId == command.operationId, value.source == command.source, value.destination == command.destination,
                  value.inspection.map(digest) == true, value.manifestRevision.map(digest) == true, value.result == nil else { throw LocalVaultSyncFailure.invalidResponse }
            if value.state == "review" {
                guard let folders = value.folders, let items = value.items, folders.count <= 20_000, items.count <= 40_000,
                      Set(folders).count == folders.count, Set(items.map(\.itemId)).count == items.count, Set(items.map(\.relativePath)).count == items.count else { throw LocalVaultSyncFailure.invalidResponse }
                try LocalVaultDocumentStore(root: root).validateFolderCatalog(folders)
                for item in items { _ = try LocalVaultDocumentStore(root: root).url(for: item.relativePath); guard digest(item.revision) else { throw LocalVaultSyncFailure.invalidResponse } }
            } else { guard value.folders == nil, value.items == nil else { throw LocalVaultSyncFailure.invalidResponse } }
        default: throw LocalVaultSyncFailure.invalidResponse
        }
    }
    static func validateReceipt(_ receipt: LocalVaultFolderCaseReceipt, command: LocalVaultFolderCaseRequest) throws {
        let folders = command.folders.map { rebase($0, command.source, command.destination) }.sorted()
        let items = command.items.map { LocalVaultFolderCaseItem(itemId: $0.itemId, relativePath: rebase($0.relativePath, command.source, command.destination), revision: $0.revision) }.sorted { $0.itemId < $1.itemId }
        guard receipt.operationId == command.operationId, receipt.status == "moved", receipt.source == command.source, receipt.destination == command.destination,
              digest(receipt.manifestRevision), receipt.folders.sorted() == folders, receipt.items.sorted(by: { $0.itemId < $1.itemId }) == items else { throw LocalVaultSyncFailure.invalidResponse }
    }
}
