import Foundation
import TextTextShareCore

public enum ShareAction: String, CaseIterable, Equatable {
    case newNote
    case newBookmark
    case newDraft
    case appendToDocument
    case saveFile

    public var title: String {
        switch self {
        case .newNote: return "New note"
        case .newBookmark: return "New bookmark"
        case .newDraft: return "New draft"
        case .appendToDocument: return "Append to document"
        case .saveFile: return "Save file"
        }
    }

    public var inboxKind: InboxItemKind {
        switch self {
        case .newNote: return .note
        case .newBookmark: return .bookmark
        case .newDraft: return .draft
        case .appendToDocument: return .append
        case .saveFile: return .file
        }
    }
}

public struct ShareExtractedContent: Equatable {
    public var title: String?
    public var text: String?
    public var urlString: String?
    /// Every shared file/image, in the order received. Sharing three images
    /// must save three files, never silently keep only the first.
    public var payloads: [InboxPayload]

    public init(
        title: String? = nil,
        text: String? = nil,
        urlString: String? = nil,
        payloads: [InboxPayload] = []
    ) {
        self.title = title
        self.text = text
        self.urlString = urlString
        self.payloads = payloads
    }

    /// Back-compat single-payload accessors used by the title/preview logic.
    public var payloadFilename: String? { payloads.first?.filename }
    public var payloadData: Data? { payloads.first?.data }

    public var suggestedTitle: String {
        if let title = title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            return title
        }
        if let payloadFilename = payloadFilename?.trimmingCharacters(in: .whitespacesAndNewlines), !payloadFilename.isEmpty {
            return (payloadFilename as NSString).deletingPathExtension
        }
        if let urlString, let url = URL(string: urlString), let host = url.host, !host.isEmpty {
            return host
        }
        if let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            return String(text.prefix(80))
        }
        return "Untitled"
    }

    public var previewLine: String {
        if let urlString, !urlString.isEmpty {
            return urlString
        }
        if let payloadFilename, !payloadFilename.isEmpty {
            return payloadFilename
        }
        if let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            return String(text.prefix(160))
        }
        return "No preview available"
    }

    public var defaultAction: ShareAction {
        if payloadData != nil { return .saveFile }
        if urlString != nil { return .newBookmark }
        return .newNote
    }
}

public enum ShareExtensionError: LocalizedError, Equatable {
    case missingAppGroupIdentifier
    case missingAppGroupContainer(String)
    case missingURL
    case missingAppendTarget
    case missingPayload

    public var errorDescription: String? {
        switch self {
        case .missingAppGroupIdentifier:
            return "The share extension is missing TextTextAppGroupIdentifier"
        case .missingAppGroupContainer(let identifier):
            return "The app group container is unavailable for \(identifier)"
        case .missingURL:
            return "A bookmark requires a URL"
        case .missingAppendTarget:
            return "Append requires a target TextText document id"
        case .missingPayload:
            return "Save file requires file data"
        }
    }
}

public enum ShareInboxItemFactory {
    public static func makeItem(
        action: ShareAction,
        title: String,
        content: ShareExtractedContent,
        targetTextTextId: String? = nil
    ) throws -> InboxItem {
        let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? content.suggestedTitle
            : title.trimmingCharacters(in: .whitespacesAndNewlines)
        switch action {
        case .newNote:
            return InboxItem(kind: .note, title: normalizedTitle, text: content.text, urlString: content.urlString)
        case .newBookmark:
            let urlString = content.urlString ?? firstURL(in: content.text)
            guard let urlString, !urlString.isEmpty else { throw ShareExtensionError.missingURL }
            return InboxItem(kind: .bookmark, title: normalizedTitle, text: content.text, urlString: urlString)
        case .newDraft:
            return InboxItem(kind: .draft, title: normalizedTitle, text: content.text, urlString: content.urlString)
        case .appendToDocument:
            let target = targetTextTextId?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let target, !target.isEmpty else { throw ShareExtensionError.missingAppendTarget }
            return InboxItem(
                kind: .append,
                title: normalizedTitle,
                text: content.text,
                urlString: content.urlString,
                targetTextTextId: target
            )
        case .saveFile:
            guard content.payloadData != nil else { throw ShareExtensionError.missingPayload }
            return InboxItem(
                kind: .file,
                title: normalizedTitle,
                text: content.text,
                urlString: content.urlString,
                payloadFilename: content.payloadFilename
            )
        }
    }

    private static func firstURL(in text: String?) -> String? {
        guard let text else { return nil }
        for token in text.split(whereSeparator: { $0.isWhitespace }) {
            let trimmed = token.trimmingCharacters(in: CharacterSet(charactersIn: ".,;:)]}"))
            if let url = URL(string: trimmed), url.scheme != nil, url.host != nil {
                return url.absoluteString
            }
        }
        return nil
    }
}

public enum ShareInboxPoster {
    /// Writes one inbox item for the action. Saving files writes one item per
    /// shared payload so nothing is dropped; every other action writes a
    /// single item.
    @discardableResult
    public static func write(
        action: ShareAction,
        title: String,
        content: ShareExtractedContent,
        targetTextTextId: String? = nil,
        containerURL: URL
    ) throws -> [InboxRecord] {
        let writer = InboxWriter(containerURL: containerURL)
        if action == .saveFile {
            guard !content.payloads.isEmpty else { throw ShareExtensionError.missingPayload }
            let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? content.suggestedTitle
                : title.trimmingCharacters(in: .whitespacesAndNewlines)
            var records: [InboxRecord] = []
            for payload in content.payloads {
                let item = InboxItem(
                    kind: .file,
                    title: normalizedTitle,
                    text: content.text,
                    urlString: content.urlString,
                    payloadFilename: payload.filename
                )
                records.append(try writer.write(item, payload: payload))
            }
            return records
        }
        let item = try ShareInboxItemFactory.makeItem(
            action: action,
            title: title,
            content: content,
            targetTextTextId: targetTextTextId
        )
        let payload = content.payloads.first
        return [try writer.write(item, payload: payload)]
    }
}

public enum ShareExtensionInboxDestination {
    public static func containerURL(bundle: Bundle = .main, fileManager: FileManager = .default) throws -> URL {
        guard let identifier = bundle.object(forInfoDictionaryKey: "TextTextAppGroupIdentifier") as? String,
              !identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ShareExtensionError.missingAppGroupIdentifier
        }
        guard let url = fileManager.containerURL(forSecurityApplicationGroupIdentifier: identifier) else {
            throw ShareExtensionError.missingAppGroupContainer(identifier)
        }
        return url
    }
}
