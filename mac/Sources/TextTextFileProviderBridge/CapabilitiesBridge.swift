import FileProvider
import TextTextFileProviderKit

// Map the kit's framework-free capability set onto NSFileProviderItemCapabilities.
// Kept as its own function so the read-only vs writable policy the kit computes
// is the single source of truth; this only translates.
//
// Apple deliberately ALIASES two pairs of bits: .allowsReading ==
// .allowsContentEnumerating (bit 1) and .allowsWriting == .allowsAddingSubItems
// (bit 2). A folder's "read" is enumeration and its "write" is adding children.
// The kit keeps them as distinct semantic flags for clarity; mapping both onto
// their (shared) NS bits is correct, not redundant, so do not "simplify" it.

public func nsCapabilities(
    from caps: TextTextItemCapabilities
) -> NSFileProviderItemCapabilities {
    var out: NSFileProviderItemCapabilities = []
    if caps.contains(.reading) { out.insert(.allowsReading) }
    if caps.contains(.writing) { out.insert(.allowsWriting) }
    if caps.contains(.renaming) { out.insert(.allowsRenaming) }
    if caps.contains(.reparenting) { out.insert(.allowsReparenting) }
    if caps.contains(.deleting) { out.insert(.allowsDeleting) }
    if caps.contains(.addingSubItems) { out.insert(.allowsAddingSubItems) }
    if caps.contains(.contentEnumerating) { out.insert(.allowsContentEnumerating) }
    return out
}
