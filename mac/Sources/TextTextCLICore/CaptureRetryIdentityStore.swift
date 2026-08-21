import CryptoKit
import Darwin
import Foundation

public struct CLICaptureRetryLease: Equatable, Sendable {
    public let fingerprint: String
    public let idempotencyKey: String

    public init(fingerprint: String, idempotencyKey: String) {
        self.fingerprint = fingerprint
        self.idempotencyKey = idempotencyKey
    }
}

/// A process-crash-safe idempotency lease for `texttext capture`. Only a
/// fingerprint and random mutation key are stored, never the captured text.
/// The lease is removed after an exact server receipt, so saving the same text
/// intentionally later still creates a new item. If a process loses the
/// response, the next identical command reuses the in-flight key.
public final class CLICaptureRetryIdentityStore: @unchecked Sendable {
    private struct StoredLease: Codable {
        let idempotencyKey: String
        let updatedAt: Date
    }

    private let directory: URL
    private let fileManager: FileManager
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }()
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
    private let staleAfter: TimeInterval

    public init(
        baseDirectory: URL,
        fileManager: FileManager = .default,
        staleAfter: TimeInterval = 7 * 24 * 60 * 60
    ) throws {
        self.fileManager = fileManager
        self.staleAfter = staleAfter
        directory = baseDirectory.appendingPathComponent(
            "capture-retry-identities", isDirectory: true)
        try fileManager.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        try? fileManager.setAttributes(
            [.posixPermissions: 0o700], ofItemAtPath: directory.path)
    }

    public static func applicationSupport(
        fileManager: FileManager = .default
    ) throws -> CLICaptureRetryIdentityStore {
        let root = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("TextText/CLI", isDirectory: true)
        return try CLICaptureRetryIdentityStore(
            baseDirectory: root, fileManager: fileManager)
    }

    public func claim(capture: String, folder: String?) throws
        -> CLICaptureRetryLease
    {
        let fingerprint = Self.fingerprint(capture: capture, folder: folder)
        let url = leaseURL(fingerprint)

        for _ in 0..<3 {
            if let existing = try? readLease(at: url) {
                if Date().timeIntervalSince(existing.updatedAt) <= staleAfter {
                    return CLICaptureRetryLease(
                        fingerprint: fingerprint,
                        idempotencyKey: existing.idempotencyKey)
                }
                try? fileManager.removeItem(at: url)
            }

            let stored = StoredLease(
                idempotencyKey: "cli-capture-\(UUID().uuidString.lowercased())",
                updatedAt: Date())
            let data = try encoder.encode(stored)
            let descriptor = open(
                url.path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0o600)
            if descriptor >= 0 {
                let handle = FileHandle(
                    fileDescriptor: descriptor, closeOnDealloc: true)
                do {
                    try handle.write(contentsOf: data)
                    try handle.synchronize()
                    try handle.close()
                    return CLICaptureRetryLease(
                        fingerprint: fingerprint,
                        idempotencyKey: stored.idempotencyKey)
                } catch {
                    try? handle.close()
                    try? fileManager.removeItem(at: url)
                    throw error
                }
            }
            if errno != EEXIST {
                throw CocoaError(
                    .fileWriteUnknown,
                    userInfo: [NSFilePathErrorKey: url.path])
            }
            usleep(10_000)
        }
        guard let existing = try? readLease(at: url) else {
            throw CocoaError(
                .fileReadUnknown,
                userInfo: [NSFilePathErrorKey: url.path])
        }
        return CLICaptureRetryLease(
            fingerprint: fingerprint,
            idempotencyKey: existing.idempotencyKey)
    }

    public func confirm(_ lease: CLICaptureRetryLease) throws {
        let url = leaseURL(lease.fingerprint)
        guard let stored = try? readLease(at: url),
            stored.idempotencyKey == lease.idempotencyKey
        else { return }
        try fileManager.removeItem(at: url)
    }

    private func readLease(at url: URL) throws -> StoredLease {
        let data = try Data(contentsOf: url)
        return try decoder.decode(StoredLease.self, from: data)
    }

    private func leaseURL(_ fingerprint: String) -> URL {
        directory.appendingPathComponent("\(fingerprint).json")
    }

    private static func fingerprint(capture: String, folder: String?) -> String {
        let payload = Data(
            (capture + "\u{0}" + (folder ?? "")).utf8)
        return SHA256.hash(data: payload).map { String(format: "%02x", $0) }
            .joined()
    }
}
