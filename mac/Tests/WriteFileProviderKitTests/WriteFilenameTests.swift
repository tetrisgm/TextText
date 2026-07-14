import XCTest
@testable import WriteFileProviderKit

final class WriteFilenameTests: XCTestCase {

    func testSlugifyMatchesServerRules() {
        // Must mirror src/lib/markdown-files.ts slugify so the " (N)" de-dup tail
        // detection lines up with the server's "<slug>-N".
        XCTAssertEqual(WriteFilename.slugify("Madonna's Best Album"), "madonna-s-best-album")
        XCTAssertEqual(WriteFilename.slugify("  Hello, World!  "), "hello-world")
        XCTAssertEqual(WriteFilename.slugify("5 Dad Jokes"), "5-dad-jokes")
        XCTAssertEqual(WriteFilename.slugify("---"), "")
    }

    func testFilenameUsesRepresentationExtension() {
        let expected: [(WriteFileRepresentation, String)] = [
            (.textbundle, "5 Dad Jokes.textbundle"),
            (.markdown, "5 Dad Jokes.md"),
            (.text, "5 Dad Jokes.txt"),
        ]
        for (representation, filename) in expected {
            XCTAssertEqual(
                WriteFilename.filename(
                    title: "5 Dad Jokes", slug: "5-dad-jokes",
                    representation: representation),
                filename)
        }
    }

    func testQuestionMarksArePortableAndRestoreTheExactTitle() {
        for representation in WriteFileRepresentation.allCases {
            let filename = WriteFilename.filename(
                title: "Why??", slug: "why", representation: representation)
            XCTAssertEqual(filename, "Why~3F~3F" + representation.filenameSuffix)
            XCTAssertEqual(
                WriteFilename.titleFromFilename(
                    filename, representation: representation),
                "Why??")
        }
    }

    func testFilenameFallsBackToSlugThenUntitled() {
        XCTAssertEqual(WriteFilename.filename(title: "", slug: "untitled-abc"), "untitled-abc.md")
        XCTAssertEqual(WriteFilename.filename(title: "", slug: ""), "untitled.md")
    }

    func testServerSlugDoesNotLeakIntoFinderTitle() {
        // Slug de-duplication is URL identity, not part of the user's title.
        XCTAssertEqual(WriteFilename.filename(title: "Foo", slug: "foo"), "Foo.md")
        XCTAssertEqual(WriteFilename.filename(title: "Foo", slug: "foo-2"), "Foo.md")
        XCTAssertEqual(WriteFilename.filename(title: "Foo", slug: "foo-13"), "Foo.md")
        XCTAssertEqual(WriteFilename.filename(title: "Foo", slug: "totally-custom"), "Foo.md")
    }

    func testPortableCodecEscapesAndRoundTripsReservedCharacters() {
        let title = "Why?? A/B: C \\ * \" < > | ~"
        let encoded = WriteFilename.encodeComponent(title)
        XCTAssertFalse(encoded.contains("?"))
        XCTAssertFalse(encoded.contains("/"))
        XCTAssertFalse(encoded.contains(":"))
        XCTAssertEqual(WriteFilename.decodeComponent(encoded), title)
        XCTAssertEqual(WriteFilename.titleFromFilename(encoded + ".md"), title)
    }

    func testPortableCodecHandlesControlsDotsSpacesAndDeviceNames() {
        let values = [".hidden", "..", "trailing. ", "CON", "LPT9.txt", "line\nfeed"]
        for value in values {
            let encoded = WriteFilename.encodeComponent(value)
            XCTAssertEqual(WriteFilename.decodeComponent(encoded), value)
            XCTAssertFalse(encoded.hasPrefix("."))
            XCTAssertFalse(encoded.hasSuffix("."))
            XCTAssertFalse(encoded.hasSuffix(" "))
        }
        XCTAssertNotEqual(WriteFilename.encodeComponent("CON"), "CON")
        XCTAssertNotEqual(WriteFilename.encodeComponent("LPT9.txt"), "LPT9.txt")
    }

    func testCodecNormalizesCanonicallyEquivalentUnicode() {
        let composed = "Caf\u{00E9}"
        let decomposed = "Cafe\u{0301}"
        XCTAssertEqual(WriteFilename.encodeComponent(composed),
                       WriteFilename.encodeComponent(decomposed))
        XCTAssertEqual(WriteFilename.decodeComponent(WriteFilename.encodeComponent(decomposed)),
                       composed)
    }

    func testOverlongEncodedComponentsAreDeterministicAndByteBounded() {
        let value = String(repeating: "?", count: 200) + "tail"
        let encoded = WriteFilename.encodeComponent(value)

        XCTAssertLessThanOrEqual(encoded.utf8.count,
                                 WriteFilename.maximumComponentUTF8Length)
        XCTAssertEqual(encoded, WriteFilename.encodeComponent(value))
        XCTAssertNotEqual(encoded, WriteFilename.encodeComponent(value + "x"))
        XCTAssertTrue(encoded.contains("~L"))
    }

    func testOverlongFilenamesBudgetEveryExtensionAndRemainCanonical() {
        let title = String(repeating: "Why? ", count: 80)
        for representation in WriteFileRepresentation.allCases {
            let filename = WriteFilename.filename(
                title: title, slug: "why", representation: representation)

            XCTAssertLessThanOrEqual(
                filename.utf8.count, WriteFilename.maximumComponentUTF8Length)
            XCTAssertTrue(filename.hasSuffix(representation.filenameSuffix))
            XCTAssertTrue(WriteFilename.isCanonicalFilename(
                filename, title: title, slug: "why", stableId: "post-1",
                representation: representation))
        }
    }

    func testCollisionSuffixRebudgetsLongNamesAndLongStableIds() {
        let title = String(repeating: "?", count: 200)
        let firstId = String(repeating: "a", count: 180) + "1"
        let secondId = String(repeating: "a", count: 180) + "2"
        for representation in WriteFileRepresentation.allCases {
            let base = WriteFilename.filename(
                title: title, slug: "same", representation: representation)
            let items = [
                fileItem(
                    id: firstId, parent: "blog", filename: base,
                    representation: representation),
                fileItem(
                    id: secondId, parent: "blog", filename: base,
                    representation: representation),
            ]

            let out = WriteFilename.disambiguate(items)
            XCTAssertEqual(Set(out.map(\.filename)).count, 2)
            XCTAssertTrue(out.allSatisfy {
                $0.filename.utf8.count <= WriteFilename.maximumComponentUTF8Length
                    && $0.filename.hasSuffix(representation.filenameSuffix)
            })
        }
    }

    func testTitleFromFilenameStripsOnlyNativeExtensions() {
        XCTAssertEqual(WriteFilename.titleFromFilename("My Great Note.md"), "My Great Note")
        XCTAssertEqual(
            WriteFilename.titleFromFilename("My Great Note.txt", representation: .text),
            "My Great Note")
        XCTAssertEqual(
            WriteFilename.titleFromFilename(
                "My Great Note.textbundle", representation: .textbundle),
            "My Great Note")
        XCTAssertEqual(WriteFilename.titleFromFilename("No Extension"), "No Extension")
        XCTAssertEqual(WriteFilename.titleFromFilename("example.com"), "example.com")
        XCTAssertEqual(WriteFilename.titleFromFilename("report.txt"), "report.txt")
        XCTAssertEqual(WriteFilename.titleFromFilename("Madonna's Best Album.md"), "Madonna's Best Album")
    }

    func testRepresentationInferencePreservesExternalMarkdownAndTextExtensions() {
        XCTAssertEqual(
            WriteFileRepresentation.inferred(fromFilename: "Draft.MD"), .markdown)
        XCTAssertEqual(
            WriteFileRepresentation.inferred(fromFilename: "Draft.TXT"), .text)
        XCTAssertEqual(
            WriteFileRepresentation.inferred(fromFilename: "Draft.textbundle"), .textbundle)
        XCTAssertNil(WriteFileRepresentation.inferred(fromFilename: "Draft.rtf"))
    }

    func testCollisionsPreserveAllRepresentationExtensions() {
        for representation in WriteFileRepresentation.allCases {
            let base = WriteFilename.filename(
                title: "Same", slug: "same", representation: representation)
            let out = WriteFilename.disambiguate([
                fileItem(
                    id: "a", parent: "blog", filename: base,
                    representation: representation),
                fileItem(
                    id: "b", parent: "blog", filename: base,
                    representation: representation),
            ])

            XCTAssertEqual(out[0].filename, "Same [a]" + representation.filenameSuffix)
            XCTAssertEqual(out[1].filename, "Same [b]" + representation.filenameSuffix)
            XCTAssertEqual(
                WriteFilename.titleFromFilename(
                    out[0].filename, stableId: "a", representation: representation),
                "Same")
        }
    }

    func testDisambiguateBreaksIntraFolderCollisions() {
        // Two posts, same title, unrelated hand-set slugs -> same filename. The
        // sibling-aware pass appends a stable id suffix to BOTH.
        let a = fileItem(id: "aaaaaa11", parent: "blog", filename: "Same.md")
        let b = fileItem(id: "bbbbbb22", parent: "blog", filename: "Same.md")
        let out = WriteFilename.disambiguate([a, b])
        XCTAssertEqual(out[0].filename, "Same [aaaaaa11].md")
        XCTAssertEqual(out[1].filename, "Same [bbbbbb22].md")
        XCTAssertEqual(WriteFilename.titleFromFilename(out[0].filename, stableId: "aaaaaa11"),
                       "Same")
    }

    func testCollisionSyntaxCannotBeImitatedByAnEncodedTitle() {
        let a = fileItem(id: "aaaaaa11", parent: "blog", filename: "Same.md")
        let b = fileItem(id: "bbbbbb22", parent: "blog", filename: "Same.md")
        let imitation = WriteFilename.filename(
            title: "Same [aaaaaa11]", slug: "same-aaaaaa11")
        let c = fileItem(id: "cccccc33", parent: "blog", filename: imitation)

        let out = WriteFilename.disambiguate([a, b, c])
        XCTAssertEqual(Set(out.map(\.filename)).count, 3)
        XCTAssertEqual(out[2].filename, "Same ~5Baaaaaa11~5D.md")
    }

    func testDisambiguateUsesUnicodeCaseFolding() {
        let a = fileItem(id: "a", parent: "blog", filename: "STRASSE.md")
        let b = fileItem(id: "b", parent: "blog", filename: "Stra\u{00DF}e.md")
        let out = WriteFilename.disambiguate([a, b])
        XCTAssertEqual(Set(out.map(\.filename)).count, 2)
        XCTAssertTrue(out.allSatisfy { $0.filename.contains("[") })
    }

    func testDisambiguateLeavesUniqueNamesAlone() {
        let a = fileItem(id: "a", parent: "blog", filename: "One.md")
        let b = fileItem(id: "b", parent: "blog", filename: "Two.md")
        // Same name but DIFFERENT parents must not collide.
        let c = fileItem(id: "c", parent: "notes", filename: "One.md")
        let out = WriteFilename.disambiguate([a, b, c])
        XCTAssertEqual(out.map(\.filename), ["One.md", "Two.md", "One.md"])
    }

    private func fileItem(
        id: String, parent: String, filename: String,
        representation: WriteFileRepresentation = .markdown
    ) -> WriteItem {
        WriteItem(
            identifier: .file(handle: "demo", id: id),
            parentIdentifier: .folder(handle: "demo", id: parent),
            filename: filename, isFolder: false, kind: .note,
            typeIdentifier: representation.typeIdentifier, serverId: id,
            contentHash: "h", documentSize: nil, creationDate: nil,
            contentModificationDate: nil, capabilities: .readOnlyFile,
            representation: representation)
    }
}
