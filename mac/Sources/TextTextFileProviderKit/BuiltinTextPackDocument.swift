import Foundation

/// New documents carry their render definition immediately, including when
/// created by a standalone CLI with no network or app bundle nearby.
public struct BuiltinTextPackDocument: Sendable {
    public let documentJSON: String
    public let templateJSON: String

    public static func create(title: String, body: String, kind: String = "note",
                              sourceURL: String? = nil) throws -> Self {
        let definitions = try JSONSerialization.jsonObject(with: Data(GeneratedBuiltinTemplates.json.utf8)) as? [[String: Any]]
        guard let template = definitions?.first(where: { ($0["id"] as? String) == "texttext.\(kind)" }),
              let id = template["id"] as? String,
              let version = template["version"] as? Int else {
            throw NSError(domain: "TextText.BuiltinTemplate", code: 1,
                             userInfo: [NSLocalizedDescriptionKey: "Unknown document template: \(kind)"])
        }
        var fields: [String: Any] = [:]
        if let sourceURL {
            fields["sourceUrl"] = sourceURL
            fields["captureStatus"] = "pending"
        }
        let document: [String: Any] = [
            "schemaVersion": 1,
            "content": ["title": title, "body": body, "fields": fields,
                        "tags": [] as [String], "assets": [] as [String]],
            "presentation": ["template": ["id": id, "version": version],
                             "theme": [:] as [String: String]],
        ]
        func json(_ value: [String: Any]) throws -> String {
            String(decoding: try JSONSerialization.data(withJSONObject: value,
                options: [.sortedKeys, .withoutEscapingSlashes]), as: UTF8.self)
        }
        return try Self(documentJSON: json(document), templateJSON: json(template))
    }
}
