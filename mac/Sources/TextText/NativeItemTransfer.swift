import AppKit
import UniformTypeIdentifiers
import TextTextAppIntents
import TextTextFileProviderKit

/// Only formats with a lossless command representation are accepted here.
/// Rich packages remain handled by the existing document importer.
enum NativeItemDrop {
    static func accepts(_ url: URL) -> Bool {
        if url.isFileURL { return ["txt", "md", "markdown"].contains(url.pathExtension.lowercased()) }
        return ["https", "http"].contains(url.scheme?.lowercased() ?? "") && url.host != nil && url.user == nil && url.password == nil
    }
    static func arguments(for url: URL) throws -> [String: Any] {
        guard accepts(url) else { throw CocoaError(.fileReadUnsupportedScheme) }
        if !url.isFileURL { return ["capture": url.absoluteString, "idempotency_key": UUID().uuidString] }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 1_000_000 else { throw CocoaError(.fileReadTooLarge) }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let bytes = try handle.read(upToCount: 1_000_001) ?? Data()
        guard bytes.count <= 1_000_000 else { throw CocoaError(.fileReadTooLarge) }
        guard let body = String(data: bytes, encoding: .utf8) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
        let item = OpenFileHandler.externalNoteImport(for: url, text: body)
        return ["title": item.title, "body": item.body,
                "kind": "note", "idempotency_key": item.idempotencyKey]
    }

    struct BatchResult {
        var imported: [String] = []
        var failures: [String] = []
    }
    static func importBatch(_ urls: [URL], execute: ([String: Any]) throws -> Void) -> BatchResult {
        var result = BatchResult()
        for url in urls {
            let name = url.lastPathComponent.isEmpty ? "link" : url.lastPathComponent
            do {
                try execute(arguments(for: url))
                result.imported.append(name)
            } catch {
                result.failures.append("\(name): \(error.localizedDescription)")
            }
        }
        return result
    }
}

/// NSItemProvider owns the lazy representation; NSFilePromiseProvider adapts it
/// to Finder and Mail's AppKit drag contract. No export occurs until accepted.
final class NativeTextPackPromise: NSFilePromiseProvider, NSFilePromiseProviderDelegate {
    let itemProvider = NSItemProvider()
    let filename: String
    init(title: String, load: @escaping (@escaping (URL?, Error?) -> Void) -> Void) {
        let safeTitle = title.components(separatedBy: CharacterSet(charactersIn: "/\\:").union(.controlCharacters)).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        filename = String((safeTitle.isEmpty ? "Untitled" : safeTitle).prefix(100)) + ".textpack"
        super.init()
        fileType = UTType("org.textbundle.pack")?.identifier ?? UTType.data.identifier
        delegate = self
        itemProvider.suggestedName = filename
        itemProvider.registerFileRepresentation(forTypeIdentifier: fileType, fileOptions: [], visibility: .all) { completion in
            // The representation lives in File Provider storage; the consumer must
            // coordinate its read, including when it requests a temporary copy.
            load { url, error in completion(url, true, error) }
            return nil
        }
    }
    static func writeFile(from source: URL, to url: URL) throws {
        var coordinationError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: [], error: &coordinationError) { destination in
            do { try FileManager.default.copyItem(at: source, to: destination) }
            catch { writeError = error }
        }
        if let error = writeError ?? coordinationError { throw error }
    }
    func filePromiseProvider(_ provider: NSFilePromiseProvider, fileNameForType fileType: String) -> String { filename }
    func filePromiseProvider(_ provider: NSFilePromiseProvider, writePromiseTo url: URL, completionHandler: @escaping (Error?) -> Void) {
        itemProvider.loadFileRepresentation(forTypeIdentifier: fileType) { source, error in
            guard let source else { completionHandler(error ?? CocoaError(.fileReadUnknown)); return }
            do { try Self.writeFile(from: source, to: url); completionHandler(nil) }
            catch { completionHandler(error) }
        }
    }
}

final class NativeExportButton: NSButton, NSDraggingSource {
    var makePromise: (() -> NativeTextPackPromise?)?
    private var promise: NativeTextPackPromise?
    override func mouseDown(with event: NSEvent) { /* drag handle, no click action */ }
    override func mouseDragged(with event: NSEvent) {
        guard isEnabled, promise == nil, let provider = makePromise?() else { return }
        promise = provider
        let item = NSDraggingItem(pasteboardWriter: provider)
        item.setDraggingFrame(bounds, contents: NSImage(named: NSImage.multipleDocumentsName))
        beginDraggingSession(with: [item], event: event, source: self)
    }
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) { promise = nil }
}
