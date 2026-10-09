import Foundation

/// New documents carry their render definition immediately, including when
/// created by a standalone CLI with no network or app bundle nearby.
public struct BuiltinTextPackDocument: Sendable {
    public let documentJSON: String
    public let templateJSON: String

    public static func validateMetadata(snapshot: String?, template: String?) throws {
        guard let snapshot, let template, snapshot.utf8.count <= 2_000_000, template.utf8.count <= 2_000_000,
              let document = try JSONSerialization.jsonObject(with: Data(snapshot.utf8)) as? [String: Any],
              document["schemaVersion"] as? Int == 1,
              let content = document["content"] as? [String: Any],
              content["title"] is String, content["body"] is String,
              content["fields"] is [String: Any], content["tags"] is [String], content["assets"] is [[String: Any]],
              let presentation = document["presentation"] as? [String: Any],
              let reference = presentation["template"] as? [String: Any],
              let definition = try JSONSerialization.jsonObject(with: Data(template.utf8)) as? [String: Any],
              definition["schemaVersion"] as? Int == 1, definition["engineVersion"] as? Int == 1,
              let id = definition["id"] as? String, !id.isEmpty,
              let version = definition["version"] as? Int, version > 0,
              reference["id"] as? String == id, reference["version"] as? Int == version,
              definition["item"] is [String: Any], definition["collection"] is [String: Any],
              definition["fields"] is [[String: Any]] else {
            throw TextTextTextBundleError.invalidPackage("The snapshot and template must be matching schema-v1 JSON objects.")
        }
    }

    public static func create(title: String, body: String, kind: String = "note",
                              sourceURL: String? = nil,
                              assets: [TextTextTextBundlePackage.MaterializedAsset] = []) throws -> Self {
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
            fields["texttextBookmarkSavedAt"] = ISO8601DateFormatter().string(from: Date())
        }
        let attachments: [[String: Any]] = assets.map { asset in
            let mediaType = asset.contentType ?? "application/octet-stream"
            let assetKind = ["image", "video", "audio"].first { mediaType.hasPrefix($0 + "/") } ?? "file"
            return ["id": "asset-" + TextTextStableDigest.sha256Hex(Data(asset.filename.utf8)),
                    "kind": assetKind, "src": "assets/\(asset.filename)",
                    "title": String(asset.filename.prefix(240)), "contentType": mediaType]
        }
        let document: [String: Any] = [
            "schemaVersion": 1,
            "content": ["title": title, "body": body, "fields": fields,
                        "tags": [] as [String], "assets": attachments],
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
