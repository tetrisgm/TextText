import XCTest
import FileProvider
@testable import WriteFileProviderExtensionCore
@testable import WriteFileProviderKit
@testable import WriteFileProviderBridge

final class FileProviderExtensionTests: XCTestCase {

    private func makeExtension() -> FileProviderExtension {
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: "workspace-test"),
            displayName: "Write")
        return FileProviderExtension(domain: domain)
    }

    private func sampleItem() -> WriteFileProviderItem {
        let entry = WriteManifestItem(
            file: "a.md", kind: "article", slug: "a", title: "A", status: "draft",
            hash: "h", id: "p1", date: nil, createdAt: nil, updatedAt: nil, url: nil)
        return WriteFileProviderItem(
            WriteItemMapper.item(for: entry, inFolder: "blog", readOnly: true)!)
    }

    // In a test bundle there is no WriteAppGroupIdentifier, so currentAPI() is
    // nil and every server-touching call reports notAuthenticated. That is
    // exactly the "signed out / handoff missing" runtime state.

    func testItemWithoutAuthIsNotAuthenticated() {
        let exp = expectation(description: "item")
        var err: NSError?
        _ = makeExtension().item(
            for: NSFileProviderItemIdentifier(rawValue: "file:p1"),
            request: NSFileProviderRequest()
        ) { _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.notAuthenticated.rawValue)
    }

    func testEnumeratorWithoutAuthThrowsNotAuthenticated() {
        XCTAssertThrowsError(
            try makeExtension().enumerator(
                for: .rootContainer, request: NSFileProviderRequest())
        ) { error in
            XCTAssertEqual((error as NSError).code, NSFileProviderError.notAuthenticated.rawValue)
        }
    }

    func testCreateItemIsRejectedReadOnly() {
        let exp = expectation(description: "create")
        var err: NSError?
        _ = makeExtension().createItem(
            basedOn: sampleItem(), fields: [], contents: nil, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.domain, NSCocoaErrorDomain)
        XCTAssertEqual(err?.code, NSFeatureUnsupportedError)
    }

    func testDeleteItemIsRejectedReadOnly() {
        let exp = expectation(description: "delete")
        var err: NSError?
        _ = makeExtension().deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "file:p1"),
            baseVersion: NSFileProviderItemVersion(
                contentVersion: Data("v".utf8), metadataVersion: Data("v".utf8)),
            options: [], request: NSFileProviderRequest()
        ) { error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.code, NSFeatureUnsupportedError)
    }

    func testModifyItemIsRejectedReadOnly() {
        let exp = expectation(description: "modify")
        var err: NSError?
        _ = makeExtension().modifyItem(
            sampleItem(),
            baseVersion: NSFileProviderItemVersion(
                contentVersion: Data("v".utf8), metadataVersion: Data("v".utf8)),
            changedFields: [], contents: nil, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.code, NSFeatureUnsupportedError)
    }
}
