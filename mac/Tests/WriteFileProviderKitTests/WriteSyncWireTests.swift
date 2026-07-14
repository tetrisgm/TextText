import Foundation
import XCTest
@testable import WriteFileProviderKit

final class WriteSyncWireTests: XCTestCase {
    func testManifestWithoutRepresentationDecodesAsMarkdown() throws {
        let data = Data(#"{"file":"posts/legacy.md","kind":"note","slug":"legacy","title":"Legacy","status":"draft","hash":"h"}"#.utf8)

        let item = try JSONDecoder().decode(WriteManifestItem.self, from: data)

        XCTAssertEqual(item.representation, .markdown)
    }

    func testManifestRepresentationsRoundTrip() throws {
        for representation in WriteFileRepresentation.allCases {
            let item = WriteManifestItem(
                file: "posts/item" + representation.filenameSuffix,
                representation: representation, kind: "note", slug: "item",
                title: "Item", status: "draft", hash: "h", id: "p1",
                date: nil, createdAt: nil, updatedAt: nil, url: nil)

            let encoded = try JSONEncoder().encode(item)
            let decoded = try JSONDecoder().decode(
                WriteManifestItem.self, from: encoded)

            XCTAssertEqual(decoded, item)
            let object = try XCTUnwrap(
                JSONSerialization.jsonObject(with: encoded) as? [String: Any])
            XCTAssertEqual(object["representation"] as? String, representation.rawValue)
        }
    }
}
