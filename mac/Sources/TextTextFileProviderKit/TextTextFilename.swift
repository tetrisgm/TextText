import CryptoKit
import Foundation

/// Fixed-size deterministic digests shared by the pure kit and its File Provider
/// adapters. File Provider version fields have a hard 128-byte ceiling, so raw
/// filenames, paths, and cursors must never be used as metadata versions.
public enum TextTextStableDigest {
    public static func sha256(_ data: Data) -> Data {
        Data(SHA256.hash(data: data))
    }

    public static func sha256(_ value: String) -> Data {
        sha256(Data(value.utf8))
    }

    public static func sha256Hex(_ value: String) -> String {
        sha256(value).map { String(format: "%02x", $0) }.joined()
    }

    public static func sha256Hex(_ data: Data) -> String {
        sha256(data).map { String(format: "%02x", $0) }.joined()
    }
}

/// The reversible, portable mapping between TextText titles and Finder path
/// components. Unsafe bytes are escaped as `~HH`; `~` itself is always escaped,
/// which makes decoding unambiguous. This preserves the actual title instead of
/// replacing punctuation with `-` or silently dropping it.
public enum TextTextFilename {
    public static let maximumComponentUTF8Length = 255

    private static let escapeMarker: UnicodeScalar = "~"
    private static let hex = Array("0123456789ABCDEF".utf8)
    // `~` is always escaped in user input, so this can never be confused with
    // an exactly reversible component emitted by the normal codec.
    private static let boundedMarker = "~L"
    private static let maximumCollisionIdentityUTF8Length = 96
    // Square brackets are portable on disk but reserved by this codec for the
    // stable collision suffix. Escaping them in user input keeps that suffix
    // namespace unambiguous without changing its existing public spelling.
    private static let reservedScalars = CharacterSet(charactersIn: "<>:\"/\\|?*[]")
    private static let windowsDeviceNames: Set<String> = {
        var names: Set<String> = ["CON", "PRN", "AUX", "NUL"]
        for number in 1...9 {
            names.insert("COM\(number)")
            names.insert("LPT\(number)")
        }
        return names
    }()

    /// Mirror of the server slugify (src/lib/post-slug.ts). Slugs remain URL
    /// identity only; this helper is retained for callers and migration tests.
    public static func slugify(_ value: String) -> String {
        let lowered = value.lowercased()
        var out = ""
        var lastDash = false
        for scalar in lowered.unicodeScalars {
            if (scalar.value >= 97 && scalar.value <= 122)
                || (scalar.value >= 48 && scalar.value <= 57) {
                out.unicodeScalars.append(scalar)
                lastDash = false
            } else if !lastDash {
                out.append("-")
                lastDash = true
            }
        }
        let dash = CharacterSet(charactersIn: "-")
        out = out.trimmingCharacters(in: dash)
        out = String(out.prefix(80))
        return out.trimmingCharacters(in: dash)
    }

    /// Encode one title or folder name as a portable path component. The result
    /// avoids Windows/macOS reserved punctuation, controls, leading dots,
    /// trailing dots/spaces, reserved DOS device names, and the escape marker.
    /// Canonically equivalent Unicode input maps to one stable NFC spelling. A
    /// normal-length value round-trips exactly. An overlong value keeps a stable
    /// readable prefix plus a digest marker so the on-disk component remains at
    /// most 255 UTF-8 bytes; the server item retains the full title/name.
    public static func encodeComponent(_ value: String) -> String {
        let normalized = value.precomposedStringWithCanonicalMapping
        return bounded(
            encodedComponent(normalized), source: normalized,
            maximumUTF8Length: maximumComponentUTF8Length)
    }

    /// Encode a component while reserving enough of the 255-byte filesystem
    /// budget for a fixed extension or collision suffix.
    public static func encodeComponent(_ value: String, appending suffix: String) -> String {
        let normalized = value.precomposedStringWithCanonicalMapping
        let suffixBytes = suffix.utf8.count
        guard suffixBytes < maximumComponentUTF8Length else {
            return String(
                decoding: suffix.utf8.prefix(maximumComponentUTF8Length),
                as: UTF8.self)
        }
        let stem = bounded(
            encodedComponent(normalized), source: normalized,
            maximumUTF8Length: maximumComponentUTF8Length - suffixBytes)
        return stem + suffix
    }

    private static func encodedComponent(_ normalized: String) -> String {
        let scalars = Array(normalized.unicodeScalars)
        guard !scalars.isEmpty else { return "" }

        var leadingDotEnd = 0
        while leadingDotEnd < scalars.count, scalars[leadingDotEnd] == "." {
            leadingDotEnd += 1
        }
        var trailingUnsafeStart = scalars.count
        while trailingUnsafeStart > 0 {
            let scalar = scalars[trailingUnsafeStart - 1]
            guard scalar == "." || scalar == " " else { break }
            trailingUnsafeStart -= 1
        }

        let firstSegment = normalized.split(separator: ".", maxSplits: 1,
                                            omittingEmptySubsequences: false).first
        let escapesDeviceName = firstSegment.map {
            windowsDeviceNames.contains(String($0).uppercased())
        } ?? false

        var output = ""
        for (index, scalar) in scalars.enumerated() {
            let value = scalar.value
            let mustEscape = scalar == escapeMarker
                || reservedScalars.contains(scalar)
                || value <= 0x1F
                || value == 0x7F
                || index < leadingDotEnd
                || index >= trailingUnsafeStart
                || (index == 0 && escapesDeviceName)

            if mustEscape {
                appendEscaped(Array(String(scalar).utf8), to: &output)
            } else {
                output.unicodeScalars.append(scalar)
            }
        }
        return output
    }

    /// Decode a component emitted by `encodeComponent`. Unknown or incomplete
    /// `~` sequences are preserved, which makes hand-authored Finder names safe
    /// to import as titles instead of corrupting them.
    public static func decodeComponent(_ value: String) -> String {
        var bytes = Data()
        var index = value.startIndex
        while index < value.endIndex {
            let next = value.index(after: index)
            if value[index] == "~",
               next < value.endIndex {
                let second = value.index(after: next)
                if second < value.endIndex,
                   let high = hexValue(value[next]),
                   let low = hexValue(value[second]) {
                    bytes.append((high << 4) | low)
                    index = value.index(after: second)
                    continue
                }
            }
            bytes.append(contentsOf: value[index..<next].utf8)
            index = next
        }
        guard let decoded = String(data: bytes, encoding: .utf8) else {
            return value.precomposedStringWithCanonicalMapping
        }
        return decoded.precomposedStringWithCanonicalMapping
    }

    /// Compatibility name for older callers. Unlike the old implementation,
    /// this is reversible and does not trim, collapse, replace, or drop content.
    public static func sanitize(_ value: String) -> String {
        encodeComponent(value)
    }

    /// The encoded leaf (without extension). A titleless item falls back to its
    /// slug, then `untitled`. Server slug de-dup suffixes are intentionally not
    /// reflected here: sibling-aware disambiguation uses stable item identity and
    /// can therefore round-trip the original title exactly.
    public static func displayLeaf(title: String, slug: String) -> String {
        let source = !title.isEmpty ? title : (!slug.isEmpty ? slug : "untitled")
        return encodeComponent(source)
    }

    public static func filename(
        title: String, slug: String,
        representation: TextTextFileRepresentation = .markdown
    ) -> String {
        let source = !title.isEmpty ? title : (!slug.isEmpty ? slug : "untitled")
        let normalized = source.precomposedStringWithCanonicalMapping
        let suffix = representation.filenameSuffix
        let leaf = bounded(
            encodedComponent(normalized), source: normalized,
            maximumUTF8Length: maximumComponentUTF8Length - suffix.utf8.count)
        return leaf + suffix
    }

    /// The exact filename forms the mapper may publish for a server title. The
    /// collision form is accepted even when this item currently has no sibling
    /// collision because a concurrent enumeration can briefly retain that stable
    /// spelling.
    public static func isCanonicalFilename(
        _ candidate: String, title: String, slug: String, stableId: String,
        representation: TextTextFileRepresentation = .markdown
    ) -> Bool {
        candidate == filename(
            title: title, slug: slug, representation: representation)
            || candidate == collisionFilename(
                title: title, slug: slug, stableId: stableId,
                representation: representation)
    }

    public static func collisionFilename(
        title: String, slug: String, stableId: String,
        representation: TextTextFileRepresentation = .markdown
    ) -> String {
        insert(
            collisionSuffix(stableId),
            into: filename(title: title, slug: slug, representation: representation),
            isFolder: false, representation: representation)
    }

    public static func isCanonicalComponent(
        _ candidate: String, value: String, stableId: String
    ) -> Bool {
        candidate == encodeComponent(value)
            || candidate == collisionComponent(value, stableId: stableId)
    }

    public static func collisionComponent(_ value: String, stableId: String) -> String {
        insert(collisionSuffix(stableId), into: encodeComponent(value), isFolder: true)
    }

    /// Reverse a Finder filename to a TextText title using its explicit native
    /// representation. The default remains Markdown for source compatibility;
    /// a title like `example.com` remains intact. When a stable id is supplied,
    /// the exact collision suffix for that item is also removed before decoding.
    public static func titleFromFilename(
        _ filename: String, stableId: String? = nil,
        representation: TextTextFileRepresentation? = nil
    ) -> String {
        var base = filename
        let extensionSuffix = nativeExtensionSuffix(
            in: base, representation: representation ?? .markdown)
        if !extensionSuffix.isEmpty {
            base.removeLast(extensionSuffix.count)
        }
        if let stableId {
            let suffix = collisionSuffix(stableId)
            if base.hasSuffix(suffix) {
                base.removeLast(suffix.count)
            }
        }
        return decodeComponent(base)
    }

    /// Give every colliding sibling a deterministic identity suffix. The full
    /// server id is used rather than a short prefix, so distinct items cannot
    /// collapse to the same Finder path. Folder/file collisions are included.
    public static func disambiguate(_ items: [TextTextItem]) -> [TextTextItem] {
        var counts: [String: Int] = [:]
        for item in items {
            counts[key(item), default: 0] += 1
        }
        guard counts.values.contains(where: { $0 > 1 }) else { return items }
        return items.map { item in
            guard (counts[key(item)] ?? 0) > 1,
                  let id = stableId(item), !id.isEmpty else { return item }
            return item.withFilename(insert(
                collisionSuffix(id), into: item.filename,
                isFolder: item.isFolder, representation: item.representation))
        }
    }

    public static func collisionSuffix(_ stableId: String) -> String {
        let normalized = stableId.precomposedStringWithCanonicalMapping
        let encoded = encodedComponent(normalized)
        let identity: String
        if encoded.utf8.count <= maximumCollisionIdentityUTF8Length {
            identity = encoded
        } else {
            identity = boundedMarker + digestHex(normalized)
        }
        return " [\(identity)]"
    }

    private static func key(_ item: TextTextItem) -> String {
        let filename = item.filename.precomposedStringWithCanonicalMapping
            .folding(options: .caseInsensitive,
                     locale: Locale(identifier: "en_US_POSIX"))
        return item.parentIdentifier.rawValue + "\n" + filename
    }

    private static func stableId(_ item: TextTextItem) -> String? {
        if let serverId = item.serverId, !serverId.isEmpty { return serverId }
        if case .workspace(let handle) = item.identifier { return handle }
        return nil
    }

    private static func insert(
        _ suffix: String, into name: String, isFolder: Bool,
        representation: TextTextFileRepresentation? = nil
    ) -> String {
        let ext = isFolder ? "" : nativeExtensionSuffix(
            in: name, representation: representation)
        let stem = ext.isEmpty ? name : String(name.dropLast(ext.count))
        let budget = maximumComponentUTF8Length - suffix.utf8.count - ext.utf8.count
        let boundedStem = bounded(
            stem, source: "collision\u{0}" + stem,
            maximumUTF8Length: max(0, budget))
        return boundedStem + suffix + ext
    }

    /// Return the actual spelling from `name` so collision handling preserves
    /// an imported `.MD`/`.TXT` suffix rather than silently normalizing it.
    private static func nativeExtensionSuffix(
        in name: String, representation: TextTextFileRepresentation?
    ) -> String {
        guard let representation = representation
                ?? TextTextFileRepresentation.inferred(fromFilename: name),
              name.lowercased().hasSuffix(representation.filenameSuffix) else {
            return ""
        }
        return String(name.suffix(representation.filenameSuffix.count))
    }

    private static func bounded(
        _ encoded: String, source: String, maximumUTF8Length: Int
    ) -> String {
        guard encoded.utf8.count > maximumUTF8Length else { return encoded }
        let marker = boundedMarker + digestHex(source)
        guard maximumUTF8Length > marker.utf8.count else {
            return String(marker.prefix(maximumUTF8Length))
        }

        let prefixBudget = maximumUTF8Length - marker.utf8.count
        var prefix = ""
        var used = 0
        var index = encoded.startIndex
        while index < encoded.endIndex {
            let tokenEnd: String.Index
            let next = encoded.index(after: index)
            if encoded[index] == "~", next < encoded.endIndex {
                let second = encoded.index(after: next)
                if second < encoded.endIndex,
                   hexValue(encoded[next]) != nil,
                   hexValue(encoded[second]) != nil {
                    tokenEnd = encoded.index(after: second)
                } else {
                    tokenEnd = next
                }
            } else {
                tokenEnd = next
            }
            let token = encoded[index..<tokenEnd]
            let count = token.utf8.count
            if used + count > prefixBudget { break }
            prefix.append(contentsOf: token)
            used += count
            index = tokenEnd
        }
        return prefix + marker
    }

    private static func digestHex(_ value: String) -> String {
        TextTextStableDigest.sha256(value).map { String(format: "%02x", $0) }.joined()
    }

    private static func appendEscaped(_ bytes: [UInt8], to output: inout String) {
        for byte in bytes {
            output.append("~")
            output.append(Character(UnicodeScalar(hex[Int(byte >> 4)])))
            output.append(Character(UnicodeScalar(hex[Int(byte & 0x0F)])))
        }
    }

    private static func hexValue(_ character: Character) -> UInt8? {
        guard character.unicodeScalars.count == 1,
              let scalar = character.unicodeScalars.first else { return nil }
        switch scalar.value {
        case 48...57: return UInt8(scalar.value - 48)
        case 65...70: return UInt8(scalar.value - 55)
        case 97...102: return UInt8(scalar.value - 87)
        default: return nil
        }
    }
}
