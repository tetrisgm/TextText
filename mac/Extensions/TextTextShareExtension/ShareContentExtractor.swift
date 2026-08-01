import Foundation
import TextTextShareCore

#if canImport(AppKit) && canImport(UniformTypeIdentifiers)
import AppKit
import UniformTypeIdentifiers

public enum ShareContentExtractor {
    public static func extract(
        from context: NSExtensionContext?,
        completion: @escaping (Result<ShareExtractedContent, Error>) -> Void
    ) {
        let providers = (context?.inputItems as? [NSExtensionItem])?
            .flatMap { $0.attachments ?? [] } ?? []
        extract(from: providers, completion: completion)
    }

    public static func extract(
        from providers: [NSItemProvider],
        completion: @escaping (Result<ShareExtractedContent, Error>) -> Void
    ) {
        let group = DispatchGroup()
        let accumulator = ShareContentAccumulator()

        for provider in providers {
            loadPlainText(from: provider, group: group, accumulator: accumulator)
            loadURL(from: provider, group: group, accumulator: accumulator)
            loadFileURL(from: provider, group: group, accumulator: accumulator)
            loadPayload(conformingTo: .pdf, defaultExtension: "pdf", from: provider, group: group, accumulator: accumulator)
            loadPayload(conformingTo: .image, defaultExtension: "image", from: provider, group: group, accumulator: accumulator)
        }

        group.notify(queue: .main) {
            completion(.success(accumulator.result()))
        }
    }

    private static func loadPlainText(
        from provider: NSItemProvider,
        group: DispatchGroup,
        accumulator: ShareContentAccumulator
    ) {
        guard provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) else { return }
        group.enter()
        provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
            defer { group.leave() }
            if let text = stringValue(from: item) {
                accumulator.setText(text)
            }
        }
    }

    private static func loadURL(
        from provider: NSItemProvider,
        group: DispatchGroup,
        accumulator: ShareContentAccumulator
    ) {
        guard provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) else { return }
        group.enter()
        provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
            defer { group.leave() }
            if let url = urlValue(from: item) {
                if url.isFileURL {
                    accumulator.setPayload(filename: url.lastPathComponent, data: (try? Data(contentsOf: url)))
                } else {
                    accumulator.setURL(url.absoluteString)
                }
            } else if let text = stringValue(from: item),
                      let url = URL(string: text), url.scheme != nil {
                accumulator.setURL(url.absoluteString)
            }
        }
    }

    private static func loadFileURL(
        from provider: NSItemProvider,
        group: DispatchGroup,
        accumulator: ShareContentAccumulator
    ) {
        guard provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) else { return }
        group.enter()
        provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
            defer { group.leave() }
            guard let url = urlValue(from: item), url.isFileURL else { return }
            accumulator.setPayload(filename: url.lastPathComponent, data: try? Data(contentsOf: url))
        }
    }

    private static func loadPayload(
        conformingTo type: UTType,
        defaultExtension: String,
        from provider: NSItemProvider,
        group: DispatchGroup,
        accumulator: ShareContentAccumulator
    ) {
        guard accumulator.needsPayload,
              let identifier = provider.registeredTypeIdentifiers.first(where: { identifier in
                  UTType(identifier)?.conforms(to: type) == true
              }) else { return }
        group.enter()
        provider.loadDataRepresentation(forTypeIdentifier: identifier) { data, _ in
            defer { group.leave() }
            guard let data, !data.isEmpty else { return }
            let filename = payloadFilename(
                suggestedName: provider.suggestedName,
                typeIdentifier: identifier,
                defaultExtension: defaultExtension
            )
            accumulator.setPayload(filename: filename, data: data)
        }
    }

    private static func stringValue(from item: NSSecureCoding?) -> String? {
        if let text = item as? String { return text }
        if let text = item as? NSString { return text as String }
        if let attributed = item as? NSAttributedString { return attributed.string }
        if let data = item as? Data { return String(data: data, encoding: .utf8) }
        if let data = item as? NSData { return String(data: data as Data, encoding: .utf8) }
        return nil
    }

    private static func urlValue(from item: NSSecureCoding?) -> URL? {
        if let url = item as? URL { return url }
        if let url = item as? NSURL { return url as URL }
        if let text = stringValue(from: item) { return URL(string: text) }
        return nil
    }

    private static func payloadFilename(
        suggestedName: String?,
        typeIdentifier: String,
        defaultExtension: String
    ) -> String {
        let type = UTType(typeIdentifier)
        let ext = type?.preferredFilenameExtension ?? defaultExtension
        let base = suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? suggestedName!.trimmingCharacters(in: .whitespacesAndNewlines)
            : "Shared File"
        if (base as NSString).pathExtension.isEmpty {
            return "\(base).\(ext)"
        }
        return base
    }
}

private final class ShareContentAccumulator {
    private let lock = NSLock()
    private var content = ShareExtractedContent()

    var needsPayload: Bool {
        lock.lock()
        defer { lock.unlock() }
        return content.payloadData == nil
    }

    func setText(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        lock.lock()
        if content.text == nil { content.text = trimmed }
        if content.title == nil {
            content.title = trimmed.split(separator: "\n", maxSplits: 1).first.map(String.init)
        }
        lock.unlock()
    }

    func setURL(_ urlString: String) {
        lock.lock()
        if content.urlString == nil { content.urlString = urlString }
        lock.unlock()
    }

    func setPayload(filename: String, data: Data?) {
        guard let data, !data.isEmpty else { return }
        lock.lock()
        content.payloads.append(InboxPayload(filename: filename, data: data))
        lock.unlock()
    }

    func result() -> ShareExtractedContent {
        lock.lock()
        defer { lock.unlock() }
        return content
    }
}
#endif
