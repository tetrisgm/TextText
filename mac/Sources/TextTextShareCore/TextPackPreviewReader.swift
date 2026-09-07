import Foundation
import zlib

/// Read just the text projection for Quick Look. No extraction, subprocesses,
/// asset fetches, or dependency on the File Provider extension's linker inputs.
public enum TextPackPreviewReader {
    public static let maximumArchiveBytes = 64 * 1024 * 1024
    public static let maximumTextBytes = 8 * 1024 * 1024
    private static var invalid: Error { CocoaError(.fileReadCorruptFile) }

    public static func markdown(at url: URL) throws -> String {
        if url.pathExtension.lowercased() == "textbundle" {
            let root = url.resolvingSymlinksInPath().standardizedFileURL
            let text = root.appendingPathComponent("text.md").resolvingSymlinksInPath()
            guard text.deletingLastPathComponent() == root else { throw invalid }
            return try decode(read(text, limit: maximumTextBytes))
        }
        return try markdown(in: read(url, limit: maximumArchiveBytes))
    }

    public static func plainText(at url: URL) throws -> String {
        try decode(read(url, limit: maximumTextBytes))
    }

    private static func read(_ url: URL, limit: Int) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: limit + 1) ?? Data()
        guard data.count <= limit else { throw CocoaError(.fileReadTooLarge) }
        return data
    }

    private static func decode(_ data: Data) throws -> String {
        guard let text = String(data: data, encoding: .utf8) else { throw invalid }
        return text
    }

    public static func markdown(in data: Data) throws -> String {
        guard data.count >= 22, data.count <= maximumArchiveBytes else { throw invalid }
        let bytes = [UInt8](data)
        func number(_ offset: Int, _ length: Int) throws -> Int {
            guard offset >= 0, length <= 4, offset <= bytes.count - length else { throw invalid }
            return (0..<length).reduce(0) { $0 | Int(bytes[offset + $1]) << (8 * $1) }
        }
        var end: Int?
        for offset in stride(from: bytes.count - 22, through: max(0, bytes.count - 65_557), by: -1) {
            if try number(offset, 4) == 0x06054b50,
               try offset + 22 + number(offset + 20, 2) == bytes.count { end = offset; break }
        }
        guard let end, try number(end + 4, 2) == 0, try number(end + 6, 2) == 0 else { throw invalid }
        let count = try number(end + 10, 2)
        let directorySize = try number(end + 12, 4)
        let directoryStart = try number(end + 16, 4)
        guard count > 0, count <= 2048, try number(end + 8, 2) == count,
              directoryStart + directorySize == end else { throw invalid }
        var cursor = directoryStart
        var found: Data?
        var names = Set<String>()
        for _ in 0..<count {
            guard cursor + 46 <= end, try number(cursor, 4) == 0x02014b50 else { throw invalid }
            let flags = try number(cursor + 8, 2)
            let method = try number(cursor + 10, 2)
            let crc = try number(cursor + 16, 4)
            let compressed = try number(cursor + 20, 4)
            let expanded = try number(cursor + 24, 4)
            let nameLength = try number(cursor + 28, 2)
            let extraLength = try number(cursor + 30, 2)
            let commentLength = try number(cursor + 32, 2)
            let attributes = try number(cursor + 38, 4)
            let local = try number(cursor + 42, 4)
            let next = cursor + 46 + nameLength + extraLength + commentLength
            guard next <= end, flags & 1 == 0, [0, 8].contains(method),
                  try number(cursor + 34, 2) == 0,
                  (attributes >> 16) & 0xf000 != 0xa000,
                  let name = String(bytes: bytes[(cursor + 46)..<(cursor + 46 + nameLength)], encoding: .utf8),
                  !name.hasPrefix("/"), !name.contains("\\"),
                  !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                  !name.split(separator: "/").contains(".."), names.insert(name).inserted else { throw invalid }
            let parts = name.split(separator: "/")
            let isText = name == "text.md" || (parts.count == 2 && parts[0].hasSuffix(".textbundle") && parts[1] == "text.md")
            if isText {
                guard found == nil, expanded <= maximumTextBytes,
                      local + 30 <= directoryStart, try number(local, 4) == 0x04034b50,
                      try number(local + 8, 2) == method, try number(local + 6, 2) == flags else { throw invalid }
                let localNameLength = try number(local + 26, 2)
                let bodyStart = try local + 30 + localNameLength + number(local + 28, 2)
                guard bodyStart <= directoryStart, compressed <= directoryStart - bodyStart,
                      localNameLength == nameLength,
                      bytes[(local + 30)..<(local + 30 + localNameLength)].elementsEqual(bytes[(cursor + 46)..<(cursor + 46 + nameLength)]) else { throw invalid }
                let payload = Data(bytes[bodyStart..<(bodyStart + compressed)])
                let result = method == 0 ? payload : try inflateRaw(payload, count: expanded)
                guard result.count == expanded else { throw invalid }
                let checksum = result.withUnsafeBytes { buffer in
                    crc32(0, buffer.bindMemory(to: Bytef.self).baseAddress, uInt(buffer.count))
                }
                guard checksum == crc else { throw invalid }
                found = result
            }
            cursor = next
        }
        guard cursor == end, let found else { throw invalid }
        return try decode(found)
    }

    private static func inflateRaw(_ input: Data, count: Int) throws -> Data {
        var stream = z_stream()
        guard inflateInit2_(&stream, -MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { throw invalid }
        defer { inflateEnd(&stream) }
        // One extra byte makes dishonest uncompressed lengths detectable.
        var output = Data(count: count + 1)
        let status = input.withUnsafeBytes { source in
            output.withUnsafeMutableBytes { destination in
                stream.next_in = UnsafeMutablePointer(mutating: source.bindMemory(to: Bytef.self).baseAddress)
                stream.avail_in = uInt(source.count)
                stream.next_out = destination.bindMemory(to: Bytef.self).baseAddress
                stream.avail_out = uInt(destination.count)
                return inflate(&stream, Z_FINISH)
            }
        }
        guard status == Z_STREAM_END, stream.total_out == count, stream.avail_in == 0 else { throw invalid }
        output.removeLast()
        return output
    }
}
