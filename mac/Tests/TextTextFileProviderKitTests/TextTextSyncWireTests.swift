import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class TextTextSyncWireTests: XCTestCase {
    func testManifestWithoutRepresentationDecodesAsMarkdown() throws {
        let data = Data(#"{"file":"posts/legacy.md","kind":"note","slug":"legacy","title":"Legacy","status":"draft","hash":"h"}"#.utf8)

        let item = try JSONDecoder().decode(TextTextManifestItem.self, from: data)

        XCTAssertEqual(item.representation, .markdown)
    }

    func testManifestRepresentationsRoundTrip() throws {
        for representation in TextTextFileRepresentation.allCases {
            let item = TextTextManifestItem(
                file: "posts/item" + representation.filenameSuffix,
                representation: representation, kind: "note", slug: "item",
                title: "Item", status: "draft", hash: "h", id: "p1",
                date: nil, createdAt: nil, updatedAt: nil, url: nil)

            let encoded = try JSONEncoder().encode(item)
            let decoded = try JSONDecoder().decode(
                TextTextManifestItem.self, from: encoded)

            XCTAssertEqual(decoded, item)
            let object = try XCTUnwrap(
                JSONSerialization.jsonObject(with: encoded) as? [String: Any])
            XCTAssertEqual(object["representation"] as? String, representation.rawValue)
        }
    }

    func testPackageRepresentationUsesDocumentValidatorAndSize() {
        let item = TextTextManifestItem(
            file: "posts/item.textpack", representation: .textpack,
            kind: "note", slug: "item", title: "Item", status: "draft",
            hash: "markdown", documentHash: "document", id: "p1",
            date: nil, createdAt: nil, updatedAt: nil, url: nil,
            size: 10, documentSize: 42)

        XCTAssertEqual(item.contentHash(), "document")
        XCTAssertEqual(item.contentSize(), 42)
        XCTAssertEqual(item.contentHash(for: .markdown), "markdown")
        XCTAssertEqual(item.contentSize(for: .markdown), 10)
    }

    func testOldManifestWithoutDocumentValidatorFallsBackToMarkdownValidator() throws {
        let data = Data(#"{"file":"posts/item.textpack","representation":"textpack","kind":"note","slug":"item","title":"Item","status":"draft","hash":"legacy","size":12}"#.utf8)

        let item = try JSONDecoder().decode(TextTextManifestItem.self, from: data)

        XCTAssertEqual(item.contentHash(), "legacy")
        XCTAssertEqual(item.contentSize(), 12)
    }
}
