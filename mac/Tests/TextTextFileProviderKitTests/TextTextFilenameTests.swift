import XCTest
@testable import TextTextFileProviderKit

final class TextTextFilenameTests: XCTestCase {

    func testSlugifyMatchesServerRules() {
        // Must mirror src/lib/markdown-files.ts slugify so the " (N)" de-dup tail
        // detection lines up with the server's "<slug>-N".
        XCTAssertEqual(TextTextFilename.slugify("Madonna's Best Album"), "madonna-s-best-album")
        XCTAssertEqual(TextTextFilename.slugify("  Hello, World!  "), "hello-world")
        XCTAssertEqual(TextTextFilename.slugify("5 Dad Jokes"), "5-dad-jokes")
        XCTAssertEqual(TextTextFilename.slugify("---"), "")
    }

    func testFilenameUsesRepresentationExtension() {
        let expected: [(TextTextFileRepresentation, String)] = [
            (.textbundle, "5 Dad Jokes.textbundle"),
            (.markdown, "5 Dad Jokes.md"),
            (.text, "5 Dad Jokes.txt"),
        ]
        for (representation, filename) in expected {
            XCTAssertEqual(
                TextTextFilename.filename(
                    title: "5 Dad Jokes", slug: "5-dad-jokes",
                    representation: representation),
                filename)
        }
    }

    func testQuestionMarksArePortableAndRestoreTheExactTitle() {
        for representation in TextTextFileRepresentation.allCases {
            let filename = TextTextFilename.filename(
                title: "Why??", slug: "why", representation: representation)
            XCTAssertEqual(filename, "Why~3F~3F" + representation.filenameSuffix)
            XCTAssertEqual(
                TextTextFilename.titleFromFilename(
                    filename, representation: representation),
                "Why??")
        }
    }

    func testFilenameFallsBackToSlugThenUntitled() {
        XCTAssertEqual(TextTextFilename.filename(title: "", slug: "untitled-abc"), "untitled-abc.md")
        XCTAssertEqual(TextTextFilename.filename(title: "", slug: ""), "untitled.md")
    }

    func testServerSlugDoesNotLeakIntoFinderTitle() {
        // Slug de-duplication is URL identity, not part of the user's title.
        XCTAssertEqual(TextTextFilename.filename(title: "Foo", slug: "foo"), "Foo.md")
        XCTAssertEqual(TextTextFilename.filename(title: "Foo", slug: "foo-2"), "Foo.md")
        XCTAssertEqual(TextTextFilename.filename(title: "Foo", slug: "foo-13"), "Foo.md")
        XCTAssertEqual(TextTextFilename.filename(title: "Foo", slug: "totally-custom"), "Foo.md")
    }

    func testPortableCodecEscapesAndRoundTripsReservedCharacters() {
        let title = "Why?? A/B: C \\ * \" < > | ~"
        let encoded = TextTextFilename.encodeComponent(title)
        XCTAssertFalse(encoded.contains("?"))
        XCTAssertFalse(encoded.contains("/"))
        XCTAssertFalse(encoded.contains(":"))
        XCTAssertEqual(TextTextFilename.decodeComponent(encoded), title)
        XCTAssertEqual(TextTextFilename.titleFromFilename(encoded + ".md"), title)
    }

    func testPortableCodecHandlesControlsDotsSpacesAndDeviceNames() {
        let values = [".hidden", "..", "trailing. ", "CON", "LPT9.txt", "line\nfeed"]
        for value in values {
            let encoded = TextTextFilename.encodeComponent(value)
            XCTAssertEqual(TextTextFilename.decodeComponent(encoded), value)
            XCTAssertFalse(encoded.hasPrefix("."))
            XCTAssertFalse(encoded.hasSuffix("."))
            XCTAssertFalse(encoded.hasSuffix(" "))
        }
        XCTAssertNotEqual(TextTextFilename.encodeComponent("CON"), "CON")
        XCTAssertNotEqual(TextTextFilename.encodeComponent("LPT9.txt"), "LPT9.txt")
    }

    func testCodecNormalizesCanonicallyEquivalentUnicode() {
        let composed = "Caf\u{00E9}"
        let decomposed = "Cafe\u{0301}"
        XCTAssertEqual(TextTextFilename.encodeComponent(composed),
                       TextTextFilename.encodeComponent(decomposed))
        XCTAssertEqual(TextTextFilename.decodeComponent(TextTextFilename.encodeComponent(decomposed)),
                       composed)
    }

    func testOverlongEncodedComponentsAreDeterministicAndByteBounded() {
        let value = String(repeating: "?", count: 200) + "tail"
        let encoded = TextTextFilename.encodeComponent(value)

        XCTAssertLessThanOrEqual(encoded.utf8.count,
                                 TextTextFilename.maximumComponentUTF8Length)
        XCTAssertEqual(encoded, TextTextFilename.encodeComponent(value))
        XCTAssertNotEqual(encoded, TextTextFilename.encodeComponent(value + "x"))
        XCTAssertTrue(encoded.contains("~L"))
    }

    func testOverlongFilenamesBudgetEveryExtensionAndRemainCanonical() {
        let title = String(repeating: "Why? ", count: 80)
        for representation in TextTextFileRepresentation.allCases {
            let filename = TextTextFilename.filename(
                title: title, slug: "why", representation: representation)

            XCTAssertLessThanOrEqual(
                filename.utf8.count, TextTextFilename.maximumComponentUTF8Length)
            XCTAssertTrue(filename.hasSuffix(representation.filenameSuffix))
            XCTAssertTrue(TextTextFilename.isCanonicalFilename(
                filename, title: title, slug: "why", stableId: "post-1",
                representation: representation))
        }
    }

    func testCollisionSuffixRebudgetsLongNamesAndLongStableIds() {
        let title = String(repeating: "?", count: 200)
        let firstId = String(repeating: "a", count: 180) + "1"
        let secondId = String(repeating: "a", count: 180) + "2"
        for representation in TextTextFileRepresentation.allCases {
            let base = TextTextFilename.filename(
                title: title, slug: "same", representation: representation)
            let items = [
                fileItem(
                    id: firstId, parent: "blog", filename: base,
                    representation: representation),
                fileItem(
                    id: secondId, parent: "blog", filename: base,
                    representation: representation),
            ]

            let out = TextTextFilename.disambiguate(items)
            XCTAssertEqual(Set(out.map(\.filename)).count, 2)
            XCTAssertTrue(out.allSatisfy {
                $0.filename.utf8.count <= TextTextFilename.maximumComponentUTF8Length
                    && $0.filename.hasSuffix(representation.filenameSuffix)
            })
        }
    }

    func testTitleFromFilenameStripsOnlyNativeExtensions() {
        XCTAssertEqual(TextTextFilename.titleFromFilename("My Great Note.md"), "My Great Note")
        XCTAssertEqual(
            TextTextFilename.titleFromFilename("My Great Note.txt", representation: .text),
            "My Great Note")
        XCTAssertEqual(
            TextTextFilename.titleFromFilename(
                "My Great Note.textbundle", representation: .textbundle),
            "My Great Note")
        XCTAssertEqual(TextTextFilename.titleFromFilename("No Extension"), "No Extension")
        XCTAssertEqual(TextTextFilename.titleFromFilename("example.com"), "example.com")
        XCTAssertEqual(TextTextFilename.titleFromFilename("report.txt"), "report.txt")
        XCTAssertEqual(TextTextFilename.titleFromFilename("Madonna's Best Album.md"), "Madonna's Best Album")
    }

    func testRepresentationInferencePreservesExternalMarkdownAndTextExtensions() {
        XCTAssertEqual(
            TextTextFileRepresentation.inferred(fromFilename: "Draft.MD"), .markdown)
        XCTAssertEqual(
            TextTextFileRepresentation.inferred(fromFilename: "Draft.TXT"), .text)
        XCTAssertEqual(
            TextTextFileRepresentation.inferred(fromFilename: "Draft.textbundle"), .textbundle)
        XCTAssertNil(TextTextFileRepresentation.inferred(fromFilename: "Draft.rtf"))
    }

    func testCollisionsPreserveAllRepresentationExtensions() {
        for representation in TextTextFileRepresentation.allCases {
            let base = TextTextFilename.filename(
                title: "Same", slug: "same", representation: representation)
            let out = TextTextFilename.disambiguate([
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
                TextTextFilename.titleFromFilename(
                    out[0].filename, stableId: "a", representation: representation),
                "Same")
        }
    }

    func testDisambiguateBreaksIntraFolderCollisions() {
        // Two posts, same title, unrelated hand-set slugs -> same filename. The
        // sibling-aware pass appends a stable id suffix to BOTH.
        let a = fileItem(id: "aaaaaa11", parent: "blog", filename: "Same.md")
        let b = fileItem(id: "bbbbbb22", parent: "blog", filename: "Same.md")
        let out = TextTextFilename.disambiguate([a, b])
        XCTAssertEqual(out[0].filename, "Same [aaaaaa11].md")
        XCTAssertEqual(out[1].filename, "Same [bbbbbb22].md")
        XCTAssertEqual(TextTextFilename.titleFromFilename(out[0].filename, stableId: "aaaaaa11"),
                       "Same")
    }

    func testCollisionSyntaxCannotBeImitatedByAnEncodedTitle() {
        let a = fileItem(id: "aaaaaa11", parent: "blog", filename: "Same.md")
        let b = fileItem(id: "bbbbbb22", parent: "blog", filename: "Same.md")
        let imitation = TextTextFilename.filename(
            title: "Same [aaaaaa11]", slug: "same-aaaaaa11")
        let c = fileItem(id: "cccccc33", parent: "blog", filename: imitation)

        let out = TextTextFilename.disambiguate([a, b, c])
        XCTAssertEqual(Set(out.map(\.filename)).count, 3)
        XCTAssertEqual(out[2].filename, "Same ~5Baaaaaa11~5D.md")
    }

    func testDisambiguateUsesUnicodeCaseFolding() {
        let a = fileItem(id: "a", parent: "blog", filename: "STRASSE.md")
        let b = fileItem(id: "b", parent: "blog", filename: "Stra\u{00DF}e.md")
        let out = TextTextFilename.disambiguate([a, b])
        XCTAssertEqual(Set(out.map(\.filename)).count, 2)
        XCTAssertTrue(out.allSatisfy { $0.filename.contains("[") })
    }

    func testDisambiguateLeavesUniqueNamesAlone() {
        let a = fileItem(id: "a", parent: "blog", filename: "One.md")
        let b = fileItem(id: "b", parent: "blog", filename: "Two.md")
        // Same name but DIFFERENT parents must not collide.
        let c = fileItem(id: "c", parent: "notes", filename: "One.md")
        let out = TextTextFilename.disambiguate([a, b, c])
        XCTAssertEqual(out.map(\.filename), ["One.md", "Two.md", "One.md"])
    }

    private func fileItem(
        id: String, parent: String, filename: String,
        representation: TextTextFileRepresentation = .markdown
    ) -> TextTextItem {
        TextTextItem(
            identifier: .file(handle: "demo", id: id),
            parentIdentifier: .folder(handle: "demo", id: parent),
            filename: filename, isFolder: false, kind: .note,
            typeIdentifier: representation.typeIdentifier, serverId: id,
            contentHash: "h", documentSize: nil, creationDate: nil,
            contentModificationDate: nil, capabilities: .readOnlyFile,
            representation: representation)
    }
}
