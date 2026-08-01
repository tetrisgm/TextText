import Foundation

public struct CapabilityManifest: Equatable, Sendable {
    public var version: Int
    public var entities: [CapabilityEntity]
    public var intents: [CapabilityIntent]

    public init(version: Int, entities: [CapabilityEntity], intents: [CapabilityIntent]) {
        self.version = version
        self.entities = entities
        self.intents = intents
    }
}

public struct CapabilityEntity: Equatable, Sendable {
    public var id: String
    public var displayName: String
    public var doc: String

    public init(id: String, displayName: String, doc: String) {
        self.id = id
        self.displayName = displayName
        self.doc = doc
    }
}

public struct CapabilityIntent: Equatable, Sendable {
    public var id: String
    public var displayName: String
    public var implementation: String
    public var availability: String
    public var result: String
    public var doc: String
    public var parameters: [CapabilityParameter]

    public init(
        id: String,
        displayName: String,
        implementation: String,
        availability: String,
        result: String,
        doc: String,
        parameters: [CapabilityParameter]
    ) {
        self.id = id
        self.displayName = displayName
        self.implementation = implementation
        self.availability = availability
        self.result = result
        self.doc = doc
        self.parameters = parameters
    }
}

public struct CapabilityParameter: Equatable, Sendable {
    public var id: String
    public var type: String
    public var displayName: String
    public var required: Bool
    public var doc: String

    public init(id: String, type: String, displayName: String, required: Bool, doc: String) {
        self.id = id
        self.type = type
        self.displayName = displayName
        self.required = required
        self.doc = doc
    }
}

public enum CapabilityManifestError: Error, LocalizedError, Equatable {
    case invalidLine(Int, String)
    case invalidIndent(Int)
    case expectedMap(Int)
    case expectedArray(Int, String)
    case missingKey(String)
    case invalidValue(String)

    public var errorDescription: String? {
        switch self {
        case .invalidLine(let line, let text):
            return "Invalid YAML line \(line): \(text)"
        case .invalidIndent(let line):
            return "Invalid YAML indentation on line \(line)"
        case .expectedMap(let line):
            return "Expected a YAML map on line \(line)"
        case .expectedArray(let line, let key):
            return "Expected a YAML array for \(key) on line \(line)"
        case .missingKey(let key):
            return "Missing required manifest key \(key)"
        case .invalidValue(let message):
            return message
        }
    }
}

public enum CapabilityManifestYAML {
    public static func parse(_ text: String) throws -> CapabilityManifest {
        let parser = YAMLSubsetParser(text: text)
        let root = try parser.parse()
        guard let map = root.mapValue else {
            throw CapabilityManifestError.expectedMap(1)
        }
        let version = try map.requiredInt("version")
        let entities = try map.requiredArray("entities").map { value -> CapabilityEntity in
            let item = try value.requiredMap()
            return CapabilityEntity(
                id: try item.requiredString("id"),
                displayName: try item.requiredString("displayName"),
                doc: try item.requiredString("doc")
            )
        }
        let intents = try map.requiredArray("intents").map { value -> CapabilityIntent in
            let item = try value.requiredMap()
            let parameters = try item.requiredArray("parameters").map { paramValue -> CapabilityParameter in
                let param = try paramValue.requiredMap()
                return CapabilityParameter(
                    id: try param.requiredString("id"),
                    type: try param.requiredString("type"),
                    displayName: try param.requiredString("displayName"),
                    required: try param.requiredBool("required"),
                    doc: try param.requiredString("doc")
                )
            }
            return CapabilityIntent(
                id: try item.requiredString("id"),
                displayName: try item.requiredString("displayName"),
                implementation: try item.requiredString("implementation"),
                availability: try item.requiredString("availability"),
                result: try item.requiredString("result"),
                doc: try item.requiredString("doc"),
                parameters: parameters
            )
        }
        return CapabilityManifest(version: version, entities: entities, intents: intents)
    }

    public static func render(_ manifest: CapabilityManifest) -> String {
        var lines: [String] = ["version: \(manifest.version)", "entities:"]
        for entity in manifest.entities {
            lines.append("  - id: \(scalar(entity.id))")
            lines.append("    displayName: \(scalar(entity.displayName))")
            lines.append("    doc: \(scalar(entity.doc))")
        }
        lines.append("intents:")
        for intent in manifest.intents {
            lines.append("  - id: \(scalar(intent.id))")
            lines.append("    displayName: \(scalar(intent.displayName))")
            lines.append("    implementation: \(scalar(intent.implementation))")
            lines.append("    availability: \(scalar(intent.availability))")
            lines.append("    result: \(scalar(intent.result))")
            lines.append("    doc: \(scalar(intent.doc))")
            lines.append("    parameters:")
            for parameter in intent.parameters {
                lines.append("      - id: \(scalar(parameter.id))")
                lines.append("        type: \(scalar(parameter.type))")
                lines.append("        displayName: \(scalar(parameter.displayName))")
                lines.append("        required: \(parameter.required ? "true" : "false")")
                lines.append("        doc: \(scalar(parameter.doc))")
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }

    private static func scalar(_ value: String) -> String {
        let safe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/+ ")
        if !value.isEmpty,
           value.rangeOfCharacter(from: safe.inverted) == nil,
           !["true", "false", "null"].contains(value.lowercased()),
           value.trimmingCharacters(in: .whitespaces) == value {
            return value
        }
        guard let data = try? JSONEncoder().encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return text
    }
}

private enum YAMLValue {
    case map([(String, YAMLValue)])
    case array([YAMLValue])
    case string(String)
    case bool(Bool)
    case int(Int)

    var mapValue: YAMLMap? {
        guard case .map(let pairs) = self else { return nil }
        return YAMLMap(pairs: pairs)
    }

    func requiredMap() throws -> YAMLMap {
        guard let map = mapValue else {
            throw CapabilityManifestError.invalidValue("Expected a map")
        }
        return map
    }
}

private struct YAMLMap {
    var pairs: [(String, YAMLValue)]

    func value(_ key: String) -> YAMLValue? {
        pairs.first { $0.0 == key }?.1
    }

    func requiredString(_ key: String) throws -> String {
        guard let value = value(key) else { throw CapabilityManifestError.missingKey(key) }
        switch value {
        case .string(let text): return text
        case .int(let number): return String(number)
        case .bool(let flag): return flag ? "true" : "false"
        case .map, .array: throw CapabilityManifestError.invalidValue("Expected scalar key \(key)")
        }
    }

    func requiredBool(_ key: String) throws -> Bool {
        guard let value = value(key) else { throw CapabilityManifestError.missingKey(key) }
        if case .bool(let flag) = value { return flag }
        throw CapabilityManifestError.invalidValue("Expected boolean key \(key)")
    }

    func requiredInt(_ key: String) throws -> Int {
        guard let value = value(key) else { throw CapabilityManifestError.missingKey(key) }
        if case .int(let number) = value { return number }
        if case .string(let text) = value, let number = Int(text) { return number }
        throw CapabilityManifestError.invalidValue("Expected integer key \(key)")
    }

    func requiredArray(_ key: String) throws -> [YAMLValue] {
        guard let value = value(key) else { throw CapabilityManifestError.missingKey(key) }
        if case .array(let values) = value { return values }
        throw CapabilityManifestError.invalidValue("Expected array key \(key)")
    }
}

private struct YAMLLine {
    var number: Int
    var indent: Int
    var content: String
}

private final class YAMLSubsetParser {
    private var lines: [YAMLLine] = []
    private var index = 0

    init(text: String) {
        for (offset, rawLine) in text.components(separatedBy: .newlines).enumerated() {
            let trimmed = rawLine.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else { continue }
            let indent = rawLine.prefix { $0 == " " }.count
            lines.append(YAMLLine(number: offset + 1, indent: indent, content: String(rawLine.dropFirst(indent))))
        }
    }

    func parse() throws -> YAMLValue {
        guard let first = lines.first else { return .map([]) }
        let value = try parseBlock(indent: first.indent)
        if index != lines.count {
            let line = lines[index]
            throw CapabilityManifestError.invalidLine(line.number, line.content)
        }
        return value
    }

    private func parseBlock(indent: Int) throws -> YAMLValue {
        guard index < lines.count else { return .map([]) }
        let line = lines[index]
        guard line.indent == indent else { throw CapabilityManifestError.invalidIndent(line.number) }
        if line.content.hasPrefix("- ") {
            return .array(try parseArray(indent: indent))
        }
        return .map(try parseMap(indent: indent))
    }

    private func parseMap(indent: Int) throws -> [(String, YAMLValue)] {
        var pairs: [(String, YAMLValue)] = []
        while index < lines.count {
            let line = lines[index]
            if line.indent < indent { break }
            guard line.indent == indent else { throw CapabilityManifestError.invalidIndent(line.number) }
            guard !line.content.hasPrefix("- ") else { break }
            let (key, rawValue) = try splitKeyValue(line)
            index += 1
            let value: YAMLValue
            if rawValue.isEmpty {
                guard index < lines.count, lines[index].indent > indent else {
                    value = .map([])
                    pairs.append((key, value))
                    continue
                }
                value = try parseBlock(indent: lines[index].indent)
            } else {
                value = try parseScalar(rawValue)
            }
            pairs.append((key, value))
        }
        return pairs
    }

    private func parseArray(indent: Int) throws -> [YAMLValue] {
        var values: [YAMLValue] = []
        while index < lines.count {
            let line = lines[index]
            if line.indent < indent { break }
            guard line.indent == indent else { throw CapabilityManifestError.invalidIndent(line.number) }
            guard line.content.hasPrefix("- ") else { break }
            let item = String(line.content.dropFirst(2))
            index += 1
            if item.isEmpty {
                guard index < lines.count, lines[index].indent > indent else {
                    values.append(.map([]))
                    continue
                }
                values.append(try parseBlock(indent: lines[index].indent))
            } else if let firstPair = try? splitKeyValue(YAMLLine(number: line.number, indent: line.indent, content: item)) {
                var pairs: [(String, YAMLValue)] = []
                if firstPair.1.isEmpty {
                    guard index < lines.count, lines[index].indent > indent else {
                        pairs.append((firstPair.0, .map([])))
                        values.append(.map(pairs))
                        continue
                    }
                    pairs.append((firstPair.0, try parseBlock(indent: lines[index].indent)))
                } else {
                    pairs.append((firstPair.0, try parseScalar(firstPair.1)))
                }
                if index < lines.count, lines[index].indent > indent {
                    guard case .map(let rest) = try parseBlock(indent: lines[index].indent) else {
                        throw CapabilityManifestError.expectedMap(lines[index].number)
                    }
                    pairs.append(contentsOf: rest)
                }
                values.append(.map(pairs))
            } else {
                values.append(try parseScalar(item))
            }
        }
        return values
    }

    private func splitKeyValue(_ line: YAMLLine) throws -> (String, String) {
        var inSingle = false
        var inDouble = false
        var escaped = false
        for index in line.content.indices {
            let char = line.content[index]
            if escaped {
                escaped = false
                continue
            }
            if char == "\\" && inDouble {
                escaped = true
                continue
            }
            if char == "'" && !inDouble { inSingle.toggle() }
            if char == "\"" && !inSingle { inDouble.toggle() }
            if char == ":" && !inSingle && !inDouble {
                let key = line.content[..<index].trimmingCharacters(in: .whitespaces)
                guard !key.isEmpty else { throw CapabilityManifestError.invalidLine(line.number, line.content) }
                let valueStart = line.content.index(after: index)
                let value = line.content[valueStart...].trimmingCharacters(in: .whitespaces)
                return (key, value)
            }
        }
        throw CapabilityManifestError.invalidLine(line.number, line.content)
    }

    private func parseScalar(_ raw: String) throws -> YAMLValue {
        if raw == "true" { return .bool(true) }
        if raw == "false" { return .bool(false) }
        if let number = Int(raw) { return .int(number) }
        if raw.hasPrefix("\""), raw.hasSuffix("\""),
           let data = raw.data(using: .utf8),
           let string = try? JSONDecoder().decode(String.self, from: data) {
            return .string(string)
        }
        if raw.hasPrefix("'"), raw.hasSuffix("'") {
            let inner = raw.dropFirst().dropLast().replacingOccurrences(of: "''", with: "'")
            return .string(inner)
        }
        return .string(raw)
    }
}
