import XCTest
@testable import TextTextFileProviderKit

final class LocalVaultCheckpointFailureKindTests: XCTestCase {
    func testTypedFailuresDoNotExportAssociatedValues() {
        let cases: [(Error, LocalVaultCheckpointFailureKind)] = [
            (LocalVaultSharedFailure.invalid, .sharedInvalid), (LocalVaultSharedFailure.staleSession, .sharedSession),
            (LocalVaultSharedFailure.generation, .sharedGeneration), (LocalVaultSharedFailure.protected, .sharedProtected),
            (LocalVaultSharedFailure.interrupted, .sharedInterrupted), (LocalVaultSharedFailure.account, .sharedAccount),
            (LocalVaultSyncFailure.busy, .syncBusy), (LocalVaultSyncFailure.changed, .syncChanged),
            (LocalVaultSyncFailure.conflict, .syncConflict), (LocalVaultSyncFailure.invalidResponse, .syncResponse),
            (LocalVaultSyncFailure.invalidBinding, .syncBinding), (LocalVaultSyncFailure.duplicateIdentity("private-path-secret"), .syncIdentity),
            (LocalVaultSyncFailure.httpStatus(599), .syncHttp),
            (RetainedFileReplacement.Failure.insufficientSpace, .replacementSpace),
            (RetainedFileReplacement.Failure.unresolved(URL(fileURLWithPath: "/private-secret")), .replacementReview),
            (RetainedFileReplacement.Failure.unsupported(99), .replacementUnsupported),
            (RetainedFileReplacement.Failure.invalidJournal, .replacementRecord),
            (LocalVaultDocumentStore.Failure.invalidPath, .documentPath), (LocalVaultDocumentStore.Failure.changed, .documentChanged),
            (LocalVaultDocumentStore.Failure.tooLarge, .documentSize), (LocalVaultDocumentStore.Failure.duplicateIdentity, .documentIdentity),
            (LocalVaultAccountRootOwnership.Failure.adoption, .ownershipAdoption),
            (LocalVaultAccountRootOwnership.Failure.account, .ownershipAccount), (LocalVaultAccountRootOwnership.Failure.future, .ownershipFuture),
            (RetainedReplacementProfile.Failure.busy, .profile), (RetainedReplacementProfile.Failure.invalidProfile, .profile),
            (ReplacementRecoveryRegistry.Failure.unresolved(UUID()), .recoveryRecord),
            (CancellationError(), .cancelled)
        ]
        for (error, expected) in cases { XCTAssertEqual(LocalVaultCheckpointFailureKind.classify(error), expected) }
        XCTAssertEqual(LocalVaultCheckpointFailureKind.allCases.count, 33)
    }
    func testOnlyBoundedKnownCocoaCodesAreClassifiedWithoutUnderlyingTraversal() {
        let cases: [(Int, LocalVaultCheckpointFailureKind)] = [
            (NSFileNoSuchFileError, .filesystemMissing), (NSFileReadNoSuchFileError, .filesystemMissing),
            (NSFileReadNoPermissionError, .filesystemPermission), (NSFileWriteNoPermissionError, .filesystemPermission),
            (NSFileWriteOutOfSpaceError, .filesystemSpace), (NSFileWriteVolumeReadOnlyError, .filesystemReadonly),
            (NSFileReadUnknownError, .filesystemOther), (NSFileWriteUnknownError, .filesystemOther),
            (NSFileReadCorruptFileError, .filesystemOther), (999999, .unknown)
        ]
        for (code, expected) in cases {
            XCTAssertEqual(LocalVaultCheckpointFailureKind.classify(NSError(domain: NSCocoaErrorDomain, code: code,
                userInfo: [NSLocalizedDescriptionKey: "token/private-path", NSUnderlyingErrorKey: CancellationError()])), expected)
        }
        XCTAssertEqual(LocalVaultCheckpointFailureKind.classify(NSError(domain: "private-domain", code: NSFileWriteOutOfSpaceError)), .unknown)
    }
}
