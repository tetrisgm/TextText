#if TEXTTEXT_STRESS_ACTOR
import Foundation
import CoreFoundation
// Read-only acceptance-protocol correlation; never a product endpoint or telemetry claim.
enum NativeStressSoakSample {
    struct Invalid: Error {}
    static func validate(_ raw: Any, runId: String?) throws -> [String: Any] {
        guard let runId, runId.range(of: #"^[A-Za-z0-9_-]{1,100}\z"#, options: .regularExpression) != nil,
              let value = raw as? [String: Any], Set(value.keys) == ["version", "id"],
              let version = value["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
              let id = value["id"] as? String, id.hasPrefix(runId + ":soak:") else { throw Invalid() }
        let ordinal = String(id.dropFirst(runId.count + 6))
        guard let number = Int(ordinal), (0...120).contains(number), String(number) == ordinal else { throw Invalid() }
        return ["version": 1, "id": id]
    }
}
#endif
