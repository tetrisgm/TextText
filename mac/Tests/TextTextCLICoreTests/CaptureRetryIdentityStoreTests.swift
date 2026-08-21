import Foundation
import XCTest
@testable import TextTextCLICore

final class CaptureRetryIdentityStoreTests: XCTestCase {
    func testAmbiguousRetryReusesIdentityUntilReceiptIsConfirmed() throws {
        let root = try temporaryDirectory()
        let store = try CLICaptureRetryIdentityStore(baseDirectory: root)

        let first = try store.claim(
            capture: "A launch thought", folder: nil)
        let retry = try store.claim(
            capture: "A launch thought", folder: nil)
        XCTAssertEqual(retry, first)

        try store.confirm(first)
        let laterIntentionalCapture = try store.claim(
            capture: "A launch thought", folder: nil)
        XCTAssertNotEqual(laterIntentionalCapture.idempotencyKey, first.idempotencyKey)
    }

    func testFolderParticipatesInIdentityAndRawCaptureIsNotStored() throws {
        let root = try temporaryDirectory()
        let store = try CLICaptureRetryIdentityStore(baseDirectory: root)

        let notes = try store.claim(capture: "Private field note", folder: "Notes")
        let research = try store.claim(
            capture: "Private field note", folder: "Notes/Research")
        XCTAssertNotEqual(notes.idempotencyKey, research.idempotencyKey)

        let retryDirectory = root.appendingPathComponent(
            "capture-retry-identities", isDirectory: true)
        let files = try FileManager.default.contentsOfDirectory(
            at: retryDirectory, includingPropertiesForKeys: nil)
        for file in files {
            let bytes = try Data(contentsOf: file)
            XCTAssertFalse(String(decoding: bytes, as: UTF8.self)
                .contains("Private field note"))
        }
    }

    func testStaleAmbiguousIdentityExpires() throws {
        let root = try temporaryDirectory()
        let store = try CLICaptureRetryIdentityStore(
            baseDirectory: root, staleAfter: 1)
        let lease = try store.claim(capture: "Old thought", folder: nil)
        let file = root.appendingPathComponent(
            "capture-retry-identities/\(lease.fingerprint).json")
        try Data(
            #"{"idempotencyKey":"old-key","updatedAt":0}"#.utf8
        ).write(to: file, options: .atomic)

        let refreshed = try store.claim(capture: "Old thought", folder: nil)

        XCTAssertNotEqual(refreshed.idempotencyKey, "old-key")
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
}
