import Foundation

/// Bounded diagnostic labels only; never serializes an exception or its userInfo.
public enum LocalVaultCheckpointFailureKind: String, Sendable, CaseIterable {
    case sharedInvalid = "shared-invalid"
    case sharedSession = "shared-session"
    case sharedGeneration = "shared-generation"
    case sharedProtected = "shared-protected"
    case sharedInterrupted = "shared-interrupted"
    case sharedAccount = "shared-account"
    case syncBusy = "sync-busy"
    case syncChanged = "sync-changed"
    case syncConflict = "sync-conflict"
    case syncResponse = "sync-response"
    case syncBinding = "sync-binding"
    case syncIdentity = "sync-identity"
    case syncHttp = "sync-http"
    case replacementSpace = "replacement-space"
    case replacementReview = "replacement-review"
    case replacementUnsupported = "replacement-unsupported"
    case replacementRecord = "replacement-record"
    case documentPath = "document-path"
    case documentChanged = "document-changed"
    case documentSize = "document-size"
    case documentIdentity = "document-identity"
    case ownershipAdoption = "ownership-adoption"
    case ownershipAccount = "ownership-account"
    case ownershipFuture = "ownership-future"
    case profile = "profile"
    case recoveryRecord = "recovery-record"
    case filesystemMissing = "filesystem-missing"
    case filesystemPermission = "filesystem-permission"
    case filesystemSpace = "filesystem-space"
    case filesystemReadonly = "filesystem-readonly"
    case filesystemOther = "filesystem-other"
    case cancelled = "cancelled"
    case unknown = "unknown"

    public static func classify(_ error: Error) -> Self {
        if error is CancellationError { return .cancelled }
        if let value = error as? LocalVaultSharedFailure {
            switch value {
            case .invalid: return .sharedInvalid
            case .staleSession: return .sharedSession
            case .generation: return .sharedGeneration
            case .protected: return .sharedProtected
            case .interrupted: return .sharedInterrupted
            case .account: return .sharedAccount
            }
        }
        if let value = error as? LocalVaultSyncFailure {
            switch value {
            case .busy: return .syncBusy
            case .changed: return .syncChanged
            case .conflict: return .syncConflict
            case .invalidResponse: return .syncResponse
            case .invalidBinding: return .syncBinding
            case .duplicateIdentity: return .syncIdentity
            case .httpStatus: return .syncHttp
            }
        }
        if let value = error as? RetainedFileReplacement.Failure {
            switch value {
            case .insufficientSpace: return .replacementSpace
            case .unresolved: return .replacementReview
            case .unsupported: return .replacementUnsupported
            case .invalidJournal: return .replacementRecord
            }
        }
        if let value = error as? LocalVaultDocumentStore.Failure {
            switch value {
            case .invalidPath: return .documentPath
            case .changed: return .documentChanged
            case .tooLarge: return .documentSize
            case .duplicateIdentity: return .documentIdentity
            }
        }
        if let value = error as? LocalVaultAccountRootOwnership.Failure {
            switch value {
            case .adoption: return .ownershipAdoption
            case .account: return .ownershipAccount
            case .future: return .ownershipFuture
            }
        }
        if error is RetainedReplacementProfile.Failure { return .profile }
        if error is ReplacementRecoveryRegistry.Failure { return .recoveryRecord }
        let native = error as NSError
        guard native.domain == NSCocoaErrorDomain else { return .unknown }
        switch native.code {
        case NSFileNoSuchFileError, NSFileReadNoSuchFileError: return .filesystemMissing
        case NSFileReadNoPermissionError, NSFileWriteNoPermissionError: return .filesystemPermission
        case NSFileWriteOutOfSpaceError: return .filesystemSpace
        case NSFileWriteVolumeReadOnlyError: return .filesystemReadonly
        case NSFileReadUnknownError, NSFileWriteUnknownError, NSFileReadCorruptFileError: return .filesystemOther
        default: return .unknown
        }
    }
}
