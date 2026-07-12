import FileProvider
import WriteFileProviderKit

// Where the framework-free kit meets the FileProvider framework. Because the
// kit's reserved raw values are Apple's own constants, bridging the identifier
// is a straight round-trip through `rawValue` with no lookup table.

public extension NSFileProviderItemIdentifier {
    init(_ id: WriteItemIdentifier) {
        self.init(rawValue: id.rawValue)
    }
}

public extension WriteItemIdentifier {
    /// Bridge back from the framework's identifier. Fails only for a raw value
    /// this kit never emits (it should never happen for identifiers we minted).
    init?(_ id: NSFileProviderItemIdentifier) {
        self.init(rawValue: id.rawValue)
    }
}
