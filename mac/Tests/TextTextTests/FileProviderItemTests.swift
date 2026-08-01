import FileProvider
import XCTest
@testable import TextTextFileProviderBridge
@testable import TextTextFileProviderKit

final class FileProviderItemRegressionTests: XCTestCase {
    private func manifest(
        id: String, title: String, hash: String = "hash",
        representation: TextTextFileRepresentation = .markdown,
        size: Int? = 1_024
    ) -> TextTextManifestItem {
        TextTextManifestItem(
            file: title + representation.filenameSuffix,
            representation: representation,
            kind: "note",
            slug: title.lowercased(),
            title: title,
            status: "draft",
            hash: hash,
            id: id,
            date: nil,
            createdAt: nil,
            updatedAt: nil,
            url: nil,
            size: size)
    }

    private func item(
        id: String, title: String,
        representation: TextTextFileRepresentation = .markdown,
        size: Int? = 1_024
    ) throws -> TextTextItem {
        try XCTUnwrap(TextTextItemMapper.item(
            for: manifest(
                id: id, title: title, representation: representation,
                size: size),
            inFolder: "notes", handle: "demo", readOnly: false))
    }

    func testTextPackLeafAdvertisesSizeWhileTextBundleDirectoryDoesNot() throws {
        let advertisedSize = 8_192
        let textPack = TextTextFileProviderItem(try item(
            id: "pack", title: "Packed", representation: .textpack,
            size: advertisedSize))
        let textBundle = TextTextFileProviderItem(try item(
            id: "bundle", title: "Bundled", representation: .textbundle,
            size: advertisedSize))

        XCTAssertEqual(textPack.documentSize?.intValue, advertisedSize)
        XCTAssertNil(
            textBundle.documentSize,
            "A textbundle is a directory package, so File Provider owns its size")
    }

    func testRenameChangesDisplayMetadataWithoutChangingStableIdentity() throws {
        let original = try item(id: "post-42", title: "Original")
        let renamed = original.withFilename("Renamed.md")
        let originalProviderItem = TextTextFileProviderItem(original)
        let renamedProviderItem = TextTextFileProviderItem(renamed)

        XCTAssertEqual(
            originalProviderItem.itemIdentifier,
            NSFileProviderItemIdentifier(rawValue: "file:demo:post-42"))
        XCTAssertEqual(
            renamedProviderItem.itemIdentifier,
            originalProviderItem.itemIdentifier,
            "A filename is display metadata and must never become item identity")
        XCTAssertEqual(
            renamedProviderItem.itemVersion.contentVersion,
            originalProviderItem.itemVersion.contentVersion,
            "Renaming a flat Markdown leaf must not detach its content identity")
    }

    func testDuplicateTitlesDisambiguateStablyWithoutCollisions() throws {
        let first = try item(id: "post-a", title: "Same title")
        let second = try item(id: "post-b", title: "Same title")

        let forward = TextTextFilename.disambiguate([first, second])
        let reversed = TextTextFilename.disambiguate([second, first])
        let forwardNames = Dictionary(uniqueKeysWithValues: forward.map {
            ($0.identifier, $0.filename)
        })
        let reversedNames = Dictionary(uniqueKeysWithValues: reversed.map {
            ($0.identifier, $0.filename)
        })

        XCTAssertEqual(Set(forward.map(\.filename)).count, 2)
        XCTAssertEqual(forwardNames, reversedNames)
        XCTAssertEqual(forwardNames[first.identifier], "Same title [post-a].md")
        XCTAssertEqual(forwardNames[second.identifier], "Same title [post-b].md")
    }
}
