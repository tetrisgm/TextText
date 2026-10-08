import Foundation
import TextTextWorkspaceCore

/// Reads only immediate, explicitly marked folder views. The source file remains
/// untouched; the selected definition is embedded in the newly created pack.
public struct LocalVaultFolderDefault {
    public let sourcePath: String
    public let sourceHash: String
    public let templateJSON: String
    public let authoringSourceJSON: String?
    public let templateId: String
    public let templateVersion: Int
    public let body: String?
    public let fields: [String: Any]
    private static func invalid() -> Error { TextTextTextBundleError.invalidPackage("The folder default is invalid or ambiguous. Open its folder view to repair it.") }
    public static func read(root: URL, folder: URL) throws -> Self? {
        let root = root.standardizedFileURL.resolvingSymlinksInPath()
        let folder = folder.standardizedFileURL.resolvingSymlinksInPath()
        guard folder.path == root.path || folder.path.hasPrefix(root.path + "/") else { throw invalid() }
        let relativeFolder = folder.path == root.path ? "" : String(folder.path.dropFirst(root.path.count + 1))
        let manager = FileManager.default
        let store = LocalVaultDocumentStore(root: root)
        let paths = try manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isSymbolicLinkKey, .fileSizeKey])
            .filter { $0.pathExtension == "textpack" }
        guard paths.count <= 2048 else { throw invalid() }
        var chosen: Self?
        var seenView = false
        var scanned = 0
        for url in paths {
            let info = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .fileSizeKey])
            guard info.isSymbolicLink != true else { throw invalid() }
            scanned += info.fileSize ?? 0
            guard scanned <= 256 * 1024 * 1024 else { throw invalid() }
            let relative = relativeFolder.isEmpty ? url.lastPathComponent : relativeFolder + "/" + url.lastPathComponent
            guard let file = try? store.readMetadata(path: relative, includeTemplate: true) else { continue }
            guard let text = file.contents.documentJSON,
                  let doc = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  let content = doc["content"] as? [String: Any],
                  let fields = content["fields"] as? [String: Any], let marker = fields["texttextFolderView"] else { continue }
            guard marker as? String == "v1", !seenView else { throw invalid() }
            seenView = true
            guard let templateText = file.contents.templateJSON,
                  let viewTemplate = try JSONSerialization.jsonObject(with: Data(templateText.utf8)) as? [String: Any],
                  let presentation = doc["presentation"] as? [String: Any], let reference = presentation["template"] as? [String: Any],
                  reference["id"] as? String == viewTemplate["id"] as? String,
                  reference["version"] as? Int == viewTemplate["version"] as? Int else { throw invalid() }
            guard let raw = fields["texttextFolderDefault"] else { continue }
            guard let raw = raw as? String, raw.utf8.count <= 1_000_000,
                  let value = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
                  Set(value.keys).isSubset(of: ["version", "template", "authoringSource"]), value["version"] as? Int == 1,
                  let template = value["template"] as? [String: Any],
                  template["schemaVersion"] as? Int == 1, template["engineVersion"] as? Int == 1,
                  let id = template["id"] as? String, id.range(of: "^[a-z][a-z0-9.-]{2,159}$", options: .regularExpression) != nil,
                  let version = template["version"] as? Int, version > 0,
                  template["item"] is [String: Any], template["collection"] is [String: Any],
                  let name = template["name"] as? String, !name.isEmpty else { throw invalid() }
            if let starter = template["starter"], !(starter is [String: Any]) { throw invalid() }
            let starter = template["starter"] as? [String: Any] ?? [:]
            if let body = starter["body"], !(body is String) { throw invalid() }
            if let fields = starter["fields"], !(fields is [String: Any]) { throw invalid() }
            if let source = value["authoringSource"] {
                guard let source = source as? [String: Any], source["kind"] as? String == "item-type-blueprint",
                      source["schemaVersion"] as? Int == 1, (source["compilerVersion"] as? Int ?? 0) > 0,
                      source["blueprint"] is [String: Any] else { throw invalid() }
            }
            chosen = Self(sourcePath: relative, sourceHash: file.hash, templateJSON: try json(template), authoringSourceJSON: try value["authoringSource"].map(json), templateId: id, templateVersion: version, body: starter["body"] as? String, fields: starter["fields"] as? [String: Any] ?? [:])
        }
        guard let chosen else { return nil }
        let retired = root.appendingPathComponent("Templates/Retired")
        let templateNames = try manager.contentsOfDirectory(atPath: root.path)
        let hasCanonicalRetirement = try templateNames.contains("Templates") && manager.contentsOfDirectory(atPath: root.appendingPathComponent("Templates").path).contains("Retired")
        if hasCanonicalRetirement {
            guard try retired.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw invalid() }
            let records = try manager.contentsOfDirectory(at: retired, includingPropertiesForKeys: nil).filter { $0.pathExtension == "textpack" }
            guard records.count <= 1000 else { throw invalid() }
            for record in records {
                let relative = "Templates/Retired/" + record.lastPathComponent
                let file = try store.readMetadata(path: relative)
                guard let text = file.contents.documentJSON,
                      let doc = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                      let content = doc["content"] as? [String: Any],
                      (content["fields"] as? [String: Any])?["texttextRecordType"] as? String == "template-retirement",
                      let value = try Self.retirementBody(file.contents.markdown),
                      value["format"] as? String == "texttext-template-retirement", value["version"] as? Int == 1 else { throw invalid() }
                if value["templateId"] as? String == chosen.templateId { throw TextTextTextBundleError.invalidPackage("The folder default template is retired. Choose another template.") }
            }
        }
        return chosen
    }
    private static func retirementBody(_ markdown: String) throws -> [String: Any]? {
        let body = MarkdownIdentityCodec.body(from: markdown)
        guard body.utf8.count <= 2048 else { throw invalid() }
        return try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any]
    }
    private static func json(_ value: Any) throws -> String { String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes]), as: UTF8.self) }
}
