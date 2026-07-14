import Foundation
import WriteWorkspaceCore

public enum EditorDocumentError: LocalizedError {
    case notInWorkspace(URL)
    case unsupportedEncoding(URL)

    public var errorDescription: String? {
        switch self {
        case .notInWorkspace(let url):
            return "\(url.lastPathComponent) is not inside the Write workspace"
        case .unsupportedEncoding(let url):
            return "\(url.lastPathComponent) is not UTF-8 text"
        }
    }
}

public enum EditorExternalChangeResult: Equatable {
    case unchanged
    case reloaded
    case conflictedCopy(URL)
    /// The external rewrite touched only the front matter (identity
    /// injection, canonicalization); it was adopted and the dirty body kept.
    case mergedIdentity
}

public enum EditorDocumentMode: Equatable {
    case workspace
    case standalone
}

/// All mutating entry points are main-thread-only; the external-change
/// handler is delivered on the main queue so every piece of document state
/// has a single owning thread.
public final class EditorDocument {
    public private(set) var fileURL: URL
    public let workspaceRootURL: URL
    public let mode: EditorDocumentMode

    public private(set) var body: String
    public private(set) var title: String
    public private(set) var isDirty = false
    public var allowsTitleEditing: Bool { mode == .workspace }

    private let coordinator: WorkspaceFileCoordinator
    private let dateProvider: () -> Date
    private var frontMatterData: Data?
    private var lastDiskData: Data
    private var titleEdited = false
    private var writeId: String?

    public convenience init(fileURL: URL, workspaceRootURL: URL) throws {
        try self.init(
            fileURL: fileURL,
            workspaceRootURL: workspaceRootURL,
            coordinator: WorkspaceFileCoordinator(rootURL: workspaceRootURL),
            mode: .workspace
        )
    }

    public convenience init(
        fileURL: URL,
        workspaceRootURL: URL,
        coordinator: WorkspaceFileCoordinator,
        dateProvider: @escaping () -> Date = Date.init
    ) throws {
        try self.init(
            fileURL: fileURL,
            workspaceRootURL: workspaceRootURL,
            coordinator: coordinator,
            dateProvider: dateProvider,
            mode: .workspace
        )
    }

    public convenience init(standaloneFileURL: URL) throws {
        try self.init(
            fileURL: standaloneFileURL,
            workspaceRootURL: standaloneFileURL.deletingLastPathComponent(),
            coordinator: WorkspaceFileCoordinator(rootURL: standaloneFileURL),
            mode: .standalone
        )
    }

    private init(
        fileURL: URL,
        workspaceRootURL: URL,
        coordinator: WorkspaceFileCoordinator,
        dateProvider: @escaping () -> Date = Date.init,
        mode: EditorDocumentMode
    ) throws {
        if mode == .workspace {
            guard let relativePath = WorkspaceLayout.relativePath(
                for: fileURL, under: workspaceRootURL),
                  !WorkspaceLayout.isInternal(relativePath: relativePath) else {
                throw EditorDocumentError.notInWorkspace(fileURL)
            }
        }
        self.fileURL = fileURL
        self.workspaceRootURL = workspaceRootURL
        self.mode = mode
        self.coordinator = coordinator
        self.dateProvider = dateProvider
        self.body = ""
        self.title = fileURL.deletingPathExtension().lastPathComponent
        self.lastDiskData = Data()

        let data = try coordinator.readData(at: fileURL)
        try applyDiskData(data)
        self.lastDiskData = data
    }

    public func setExternalChangeHandler(_ handler: (() -> Void)?) {
        guard let handler else {
            coordinator.onPresentedItemChange = nil
            return
        }
        // The presenter fires on its own queue; document state is owned by
        // the main thread, so delivery hops there before anything is read.
        coordinator.onPresentedItemChange = {
            DispatchQueue.main.async(execute: handler)
        }
    }

    public func setBody(_ newBody: String) {
        guard body != newBody else { return }
        body = newBody
        isDirty = true
    }

    public func setTitle(_ newTitle: String) {
        guard allowsTitleEditing else { return }
        guard title != newTitle else { return }
        title = newTitle
        titleEdited = true
        isDirty = true
    }

    public func save() throws {
        relocateIfMoved()
        let data = try renderedData()
        // Compare-and-swap: a write that landed after our last read must
        // never be clobbered silently. Identity-only rewrites are adopted;
        // real content is preserved as a conflicted copy before we write.
        if let onDisk = try? coordinator.readData(at: fileURL),
           onDisk != lastDiskData, onDisk != data {
            if let adopted = identityOnlyFrontMatter(incoming: onDisk) {
                adoptFrontMatter(adopted)
                lastDiskData = onDisk
                let merged = try renderedData()
                try coordinator.writeData(merged, to: fileURL)
                lastDiskData = merged
                finishSave()
                return
            }
            let conflictURL = copyURL(for: fileURL, marker: "conflicted copy")
            try coordinator.writeData(onDisk, to: conflictURL)
        }
        try coordinator.writeData(data, to: fileURL)
        lastDiskData = data
        finishSave()
    }

    /// Last-resort save for window close: when the primary save fails, the
    /// buffer is preserved in the device-local recovery directory (the
    /// document's own directory may be the thing that is failing).
    /// Returns the recovery URL when one had to be written.
    public func saveOrRecover() -> URL? {
        do {
            try save()
            return nil
        } catch {
            let recoveryDirectory = recoveryDirectoryURL()
            try? FileManager.default.createDirectory(
                at: recoveryDirectory, withIntermediateDirectories: true)
            let recoveryURL = copyURL(
                for: recoveryDirectory.appendingPathComponent(fileURL.lastPathComponent),
                marker: "recovered copy"
            )
            if let data = try? renderedData() {
                try? data.write(to: recoveryURL, options: .atomic)
            }
            return recoveryURL
        }
    }

    @discardableResult
    public func reloadIfClean() throws -> EditorExternalChangeResult {
        guard !isDirty else { return .unchanged }
        relocateIfMoved()
        let incoming = try coordinator.readData(at: fileURL)
        guard incoming != lastDiskData else { return .unchanged }
        try applyDiskData(incoming)
        lastDiskData = incoming
        return .reloaded
    }

    @discardableResult
    public func handleExternalChange() throws -> EditorExternalChangeResult {
        relocateIfMoved()
        let incoming = try coordinator.readData(at: fileURL)
        guard incoming != lastDiskData else { return .unchanged }

        if !isDirty {
            try applyDiskData(incoming)
            lastDiskData = incoming
            return .reloaded
        }

        let localData = try renderedData()
        if incoming == localData {
            lastDiskData = incoming
            titleEdited = false
            isDirty = false
            return .unchanged
        }

        if let adopted = identityOnlyFrontMatter(incoming: incoming) {
            adoptFrontMatter(adopted)
            lastDiskData = incoming
            return .mergedIdentity
        }

        let conflictURL = copyURL(for: fileURL, marker: "conflicted copy")
        try coordinator.writeData(incoming, to: conflictURL)
        lastDiskData = incoming
        return .conflictedCopy(conflictURL)
    }

    public func conflictedCopyURL(for url: URL) -> URL {
        copyURL(for: url, marker: "conflicted copy")
    }

    private func copyURL(for url: URL, marker: String) -> URL {
        let fileManager = FileManager.default
        let stem = url.deletingPathExtension().lastPathComponent
        let pathExtension = url.pathExtension
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HHmm"
        let stamp = formatter.string(from: dateProvider())
        func filename(_ suffix: String) -> String {
            let base = "\(stem) (\(marker) \(stamp)\(suffix))"
            return pathExtension.isEmpty ? base : "\(base).\(pathExtension)"
        }
        var candidate = url.deletingLastPathComponent()
            .appendingPathComponent(filename(""))
        var number = 2
        while fileManager.fileExists(atPath: candidate.path) {
            candidate = url.deletingLastPathComponent()
                .appendingPathComponent(filename(" \(number)"))
            number += 1
        }
        return candidate
    }

    /// The sync engine renames files when the server's slug is authoritative.
    /// When our path no longer exists, follow the file by its writeId so the
    /// next save lands at the file's new home instead of resurrecting the
    /// dead path as a duplicate the server will reject.
    private func relocateIfMoved() {
        guard mode == .workspace else { return }
        let fileManager = FileManager.default
        guard !fileManager.fileExists(atPath: fileURL.path), let writeId else { return }
        let match = WorkspaceIndexStore.identityFiles(root: workspaceRootURL)
            .first { $0.itemId == writeId }
        guard let match else { return }
        let candidate = workspaceRootURL.appendingPathComponent(match.entry.relativePath)
        if fileManager.fileExists(atPath: candidate.path) {
            fileURL = candidate
        }
    }

    /// The incoming front matter when the external rewrite changed ONLY the
    /// front matter (body bytes identical to the last disk state); nil when
    /// the body changed too, which is a real conflict.
    private func identityOnlyFrontMatter(incoming: Data) -> Data? {
        guard mode == .workspace else { return nil }
        let incomingSplit = MarkdownFrontMatter.split(incoming)
        guard let incomingFrontMatter = incomingSplit.frontMatter else { return nil }
        let lastSplit = MarkdownFrontMatter.split(lastDiskData)
        guard incomingSplit.body == lastSplit.body else { return nil }
        return incomingFrontMatter
    }

    private func adoptFrontMatter(_ adopted: Data) {
        frontMatterData = adopted
        writeId = MarkdownIdentityCodec.extract(
            from: String(decoding: adopted, as: UTF8.self)
        )?.itemId ?? writeId
        if !titleEdited {
            title = MarkdownFrontMatter.title(in: adopted)
                ?? fileURL.deletingPathExtension().lastPathComponent
        }
    }

    private func finishSave() {
        if mode == .workspace, titleEdited {
            frontMatterData = MarkdownFrontMatter.rewritingTitle(in: frontMatterData, to: title)
        }
        titleEdited = false
        isDirty = false
    }

    private func renderedData() throws -> Data {
        if mode == .standalone { return Data(body.utf8) }
        let renderedFrontMatter = titleEdited
            ? MarkdownFrontMatter.rewritingTitle(in: frontMatterData, to: title)
            : frontMatterData
        var data = Data()
        if let renderedFrontMatter {
            data.append(renderedFrontMatter)
        }
        data.append(Data(body.utf8))
        return data
    }

    private func applyDiskData(_ data: Data) throws {
        if mode == .standalone {
            guard let text = String(data: data, encoding: .utf8) else {
                throw EditorDocumentError.unsupportedEncoding(fileURL)
            }
            frontMatterData = nil
            body = text
            title = fileURL.deletingPathExtension().lastPathComponent
            writeId = nil
            titleEdited = false
            isDirty = false
            return
        }
        let split = MarkdownFrontMatter.split(data)
        guard let bodyText = String(data: split.body, encoding: .utf8) else {
            throw EditorDocumentError.unsupportedEncoding(fileURL)
        }
        frontMatterData = split.frontMatter
        body = bodyText
        title = split.frontMatter.flatMap(MarkdownFrontMatter.title(in:))
            ?? fileURL.deletingPathExtension().lastPathComponent
        writeId = split.frontMatter.flatMap {
            MarkdownIdentityCodec.extract(from: String(decoding: $0, as: UTF8.self))?.itemId
        } ?? writeId
        titleEdited = false
        isDirty = false
    }

    private func recoveryDirectoryURL() -> URL {
        if mode == .workspace {
            return workspaceRootURL
                .appendingPathComponent(
                    WorkspaceLayout.localMetadataDirectoryName, isDirectory: true)
                .appendingPathComponent("recovery", isDirectory: true)
        }
        let fileManager = FileManager.default
        let support = fileManager.urls(
            for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support", isDirectory: true)
        return support
            .appendingPathComponent("Write", isDirectory: true)
            .appendingPathComponent("Recovery", isDirectory: true)
    }
}

public enum EditorNoteCreator {
    public static func createUntitledNote(
        in workspaceRootURL: URL,
        coordinator: WorkspaceFileCoordinator? = nil
    ) throws -> URL {
        let fileCoordinator = coordinator ?? WorkspaceFileCoordinator(rootURL: workspaceRootURL)
        let notesDirectory = workspaceRootURL.appendingPathComponent("Notes", isDirectory: true)
        let fileURL = availableUntitledURL(in: notesDirectory)
        // The title matches the unique file stem ("Untitled", "Untitled 2");
        // identical titles would collide on the server slug and the second
        // note would silently never sync.
        let stem = fileURL.deletingPathExtension().lastPathComponent
        let encodedTitle: String
        if let data = try? JSONEncoder().encode(stem),
           let encoded = String(data: data, encoding: .utf8) {
            encodedTitle = encoded
        } else {
            encodedTitle = "\"\(stem)\""
        }
        let body = """
        ---
        title: \(encodedTitle)
        kind: note
        status: draft
        ---

        """
        try fileCoordinator.writeData(Data(body.utf8), to: fileURL)
        return fileURL
    }

    private static func availableUntitledURL(in directory: URL) -> URL {
        let fileManager = FileManager.default
        var candidate = directory.appendingPathComponent("Untitled.md")
        var number = 2
        while fileManager.fileExists(atPath: candidate.path) {
            candidate = directory.appendingPathComponent("Untitled \(number).md")
            number += 1
        }
        return candidate
    }
}

enum MarkdownFrontMatter {
    static func split(_ data: Data) -> (frontMatter: Data?, body: Data) {
        let bytes = [UInt8](data)
        let start: Int
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) {
            start = 3
        } else {
            start = 0
        }
        guard hasOpeningDelimiter(bytes, at: start),
              let openingLineEnd = nextLineStart(in: bytes, from: start) else {
            return (nil, data)
        }

        var cursor = openingLineEnd
        while cursor <= bytes.count {
            let bounds = lineBounds(in: bytes, from: cursor)
            if isClosingDelimiter(bytes[bounds.content]) {
                let bodyStart = bounds.next
                return (
                    data.subdata(in: 0..<bodyStart),
                    data.subdata(in: bodyStart..<data.count)
                )
            }
            guard bounds.next > cursor else { break }
            cursor = bounds.next
        }
        return (nil, data)
    }

    static func title(in frontMatter: Data) -> String? {
        for line in logicalLines(in: frontMatter) {
            guard let parsed = parseTitleLine(String(decoding: line, as: UTF8.self)) else { continue }
            return decodedTitle(from: parsed.rawValue)
        }
        return nil
    }

    static func rewritingTitle(in frontMatter: Data?, to title: String) -> Data {
        guard let frontMatter else {
            return Data("---\ntitle: \(renderedTitle(title, style: .doubleQuoted))\n---\n\n".utf8)
        }

        let bytes = [UInt8](frontMatter)
        var cursor = 0
        while cursor < bytes.count {
            let bounds = lineBounds(in: bytes, from: cursor)
            let contentData = Data(bytes[bounds.content])
            let line = String(decoding: contentData, as: UTF8.self)
            if let parsed = parseTitleLine(line) {
                var rewritten = Data()
                rewritten.append(frontMatter.subdata(in: 0..<bounds.content.lowerBound))
                rewritten.append(contentData.prefix(parsed.valueStartByteOffset))
                rewritten.append(Data(renderedTitle(title, style: parsed.style).utf8))
                rewritten.append(Data(bytes[bounds.lineEnding]))
                rewritten.append(frontMatter.subdata(in: bounds.next..<frontMatter.count))
                return rewritten
            }
            guard bounds.next > cursor else { break }
            cursor = bounds.next
        }

        guard let openingLineEnd = nextLineStart(in: bytes, from: 0) else {
            return Data("---\ntitle: \(renderedTitle(title, style: .doubleQuoted))\n---\n\n".utf8)
        }
        let lineEnding = openingLineEnding(in: bytes) ?? Data("\n".utf8)
        var rewritten = Data()
        rewritten.append(frontMatter.subdata(in: 0..<openingLineEnd))
        rewritten.append(Data("title: \(renderedTitle(title, style: .doubleQuoted))".utf8))
        rewritten.append(lineEnding)
        rewritten.append(frontMatter.subdata(in: openingLineEnd..<frontMatter.count))
        return rewritten
    }

    private enum QuoteStyle {
        case doubleQuoted
        case singleQuoted
        case unquoted
    }

    private struct ParsedTitleLine {
        var valueStartByteOffset: Int
        var rawValue: String
        var style: QuoteStyle
    }

    private struct LineBounds {
        var content: Range<Int>
        var lineEnding: Range<Int>
        var next: Int
    }

    private static func hasOpeningDelimiter(_ bytes: [UInt8], at start: Int) -> Bool {
        guard bytes.count >= start + 3,
              bytes[start] == 45,
              bytes[start + 1] == 45,
              bytes[start + 2] == 45 else {
            return false
        }
        let after = start + 3
        return after == bytes.count || bytes[after] == 10 || (bytes[after] == 13 && after + 1 < bytes.count && bytes[after + 1] == 10)
    }

    private static func lineBounds(in bytes: [UInt8], from start: Int) -> LineBounds {
        var newline = start
        while newline < bytes.count, bytes[newline] != 10 {
            newline += 1
        }
        let contentEnd = newline > start && bytes[newline - 1] == 13 ? newline - 1 : newline
        let endingStart = contentEnd
        let next = newline < bytes.count ? newline + 1 : bytes.count
        return LineBounds(content: start..<contentEnd, lineEnding: endingStart..<next, next: next)
    }

    private static func nextLineStart(in bytes: [UInt8], from start: Int) -> Int? {
        let bounds = lineBounds(in: bytes, from: start)
        return bounds.next > start ? bounds.next : nil
    }

    private static func isClosingDelimiter(_ bytes: ArraySlice<UInt8>) -> Bool {
        var start = bytes.startIndex
        var end = bytes.endIndex
        while start < end, bytes[start] == 32 || bytes[start] == 9 {
            start = bytes.index(after: start)
        }
        while start < end {
            let beforeEnd = bytes.index(before: end)
            guard bytes[beforeEnd] == 32 || bytes[beforeEnd] == 9 else { break }
            end = beforeEnd
        }
        return Array(bytes[start..<end]) == [45, 45, 45]
    }

    private static func logicalLines(in data: Data) -> [Data] {
        let bytes = [UInt8](data)
        var lines: [Data] = []
        var cursor = 0
        while cursor < bytes.count {
            let bounds = lineBounds(in: bytes, from: cursor)
            let content = Data(bytes[bounds.content])
            if !isClosingDelimiter(bytes[bounds.content]), !hasOpeningDelimiter(bytes, at: bounds.content.lowerBound) {
                lines.append(content)
            }
            guard bounds.next > cursor else { break }
            cursor = bounds.next
        }
        return lines
    }

    private static func parseTitleLine(_ line: String) -> ParsedTitleLine? {
        let scalars = Array(line.unicodeScalars)
        var index = 0
        while index < scalars.count, scalars[index].isHorizontalWhitespace {
            index += 1
        }
        guard index < scalars.count else { return nil }
        guard scalars[index...].starts(with: "title".unicodeScalars) else { return nil }
        index += "title".count
        while index < scalars.count, scalars[index].isHorizontalWhitespace {
            index += 1
        }
        guard index < scalars.count, scalars[index] == ":" else { return nil }
        index += 1
        while index < scalars.count, scalars[index].isHorizontalWhitespace {
            index += 1
        }

        let stringIndex = line.unicodeScalars.index(line.unicodeScalars.startIndex, offsetBy: index)
        let valueStart = String.Index(stringIndex, within: line) ?? line.endIndex
        let rawValue = String(line[valueStart...])
        let style: QuoteStyle
        let trimmed = rawValue.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("\"") {
            style = .doubleQuoted
        } else if trimmed.hasPrefix("'") {
            style = .singleQuoted
        } else {
            style = .unquoted
        }
        return ParsedTitleLine(
            valueStartByteOffset: index,
            rawValue: rawValue,
            style: style
        )
    }

    private static func decodedTitle(from rawValue: String) -> String {
        let trimmed = rawValue.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("\""),
           let data = trimmed.data(using: .utf8),
           let decoded = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? String {
            return decoded
        }
        if trimmed.hasPrefix("'"), trimmed.hasSuffix("'"), trimmed.count >= 2 {
            let inner = trimmed.dropFirst().dropLast()
            return inner.replacingOccurrences(of: "''", with: "'")
        }
        return trimmed
    }

    private static func renderedTitle(_ title: String, style: QuoteStyle) -> String {
        let singleLine = title.replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
        switch style {
        case .doubleQuoted:
            if let data = try? JSONEncoder().encode(singleLine),
               let encoded = String(data: data, encoding: .utf8) {
                return encoded
            }
            return "\"\(singleLine.replacingOccurrences(of: "\"", with: "\\\""))\""
        case .singleQuoted:
            return "'\(singleLine.replacingOccurrences(of: "'", with: "''"))'"
        case .unquoted:
            return singleLine.isEmpty ? "\"\"" : singleLine
        }
    }

    private static func openingLineEnding(in bytes: [UInt8]) -> Data? {
        let bounds = lineBounds(in: bytes, from: 0)
        guard !bounds.lineEnding.isEmpty else { return nil }
        return Data(bytes[bounds.lineEnding])
    }
}

private extension Unicode.Scalar {
    var isHorizontalWhitespace: Bool {
        self == " " || self == "\t"
    }
}
