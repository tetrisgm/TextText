import TextTextFileProviderKit
import XCTest

@testable import TextTextCLICore

final class RemoteDocumentStoreTests: XCTestCase {
    func testCLIWorkspaceChoosesSignedInDeviceCredentialWithoutAMount() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let credential = root.appendingPathComponent("credentials.json")
        try Data(
            """
            {"token":"wsk_device","serverOrigin":"https://texttext.app"}
            """.utf8
        ).write(to: credential)

        let workspace = try CLIWorkspace.locate(environment: [
            "TEXTTEXT_CREDENTIALS_PATH": credential.path
        ])

        XCTAssertTrue(workspace.usesRemoteSync)
    }

    func testExplicitWorkspaceRootStillSelectsTheLocalBackend() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let credential = root.appendingPathComponent("credentials.json")
        try Data(
            """
            {"token":"wsk_device","serverOrigin":"https://texttext.app"}
            """.utf8
        ).write(to: credential)

        let workspace = try CLIWorkspace.locate(environment: [
            "TEXTTEXT_CREDENTIALS_PATH": credential.path,
            "TEXTTEXT_WORKSPACE_ROOT": root.path,
        ])

        XCTAssertFalse(workspace.usesRemoteSync)
    }

    func testMissingCredentialDoesNotSilentlyDependOnAFileProviderMount() {
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-missing-\(UUID().uuidString).json")
        XCTAssertThrowsError(
            try CLIWorkspace.locate(environment: [
                "TEXTTEXT_CREDENTIALS_PATH": missing.path
            ])
        ) { error in
            XCTAssertEqual(error as? TextTextCLIError, .workspaceNotFound)
        }
    }

    func testRemoteWorkspaceRejectsAbsoluteDocumentPaths() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let credential = root.appendingPathComponent("credentials.json")
        try Data(
            """
            {"token":"wsk_device","serverOrigin":"https://texttext.app"}
            """.utf8
        ).write(to: credential)
        let workspace = try CLIWorkspace.locate(environment: [
            "TEXTTEXT_CREDENTIALS_PATH": credential.path
        ])

        do {
            _ = try await workspace.resolve("/tmp/outside.textpack")
            XCTFail("expected an absolute remote path to be rejected")
        } catch TextTextCLIError.invalidDocument(let reason) {
            XCTAssertTrue(reason.contains("workspace-relative"))
        }
    }

    func testListsNestedDocumentsWithoutAFileProviderMount() async throws {
        let notes = folder(id: "notes", name: "Notes", path: "Notes", mode: "notes")
        let research = folder(
            id: "research", name: "Research", path: "Notes/Research",
            mode: "notes", parentId: notes.id)
        let api = FakeCLISyncAPI(
            workspace: workspace(folders: [notes, research]),
            manifests: [
                notes.id: [item(id: "recent", title: "Recent")],
                research.id: [
                    item(id: "same-1", title: "Same"),
                    item(id: "same-2", title: "Same"),
                ],
            ])
        let store = RemoteDocumentStore(api: api)

        let paths = try await store.list()

        XCTAssertTrue(paths.contains("Notes/Recent.textpack"))
        XCTAssertEqual(paths.filter { $0.hasPrefix("Notes/Research/Same") }.count, 2)
        let researchPaths = try await store.list(under: "Notes/Research")
        XCTAssertEqual(researchPaths.count, 2)
    }

    func testReadThenWriteUsesTheCommandHashAndAgentAttribution() async throws {
        let notes = folder(id: "notes", name: "Notes", path: "Notes", mode: "notes")
        let api = FakeCLISyncAPI(
            workspace: workspace(folders: [notes]),
            manifests: [notes.id: [item(id: "recent", title: "Recent")]],
            contents: ["recent": ("# Before\n", "hash-1")])
        let store = RemoteDocumentStore(api: api)
        let document = try await store.resolve("Recent")

        let body = try await store.readMarkdown(at: document)
        XCTAssertEqual(body, "# Before\n")
        let actor = AgentActor(
            name: "Codex", activity: .edit,
            message: "Tighten the introduction", itemId: document.itemId)
        try await CLICommandActor.$current.withValue(actor) {
            try await store.writeMarkdown("# After\n", to: document)
        }

        let capturedRequest = await api.lastPut()
        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(request.postId, "recent")
        XCTAssertEqual(request.markdown, "# After\n")
        XCTAssertEqual(request.hash, "hash-1")
        XCTAssertEqual(request.agentName, "Codex")
        XCTAssertEqual(request.agentIntent, "Tighten the introduction")
        let readCount = await api.commandReadCount()
        XCTAssertEqual(readCount, 1, "the guarded write must reuse its read")
    }

    func testConflictIsReportedAsAChangedDocument() async throws {
        let notes = folder(id: "notes", name: "Notes", path: "Notes", mode: "notes")
        let api = FakeCLISyncAPI(
            workspace: workspace(folders: [notes]),
            manifests: [notes.id: [item(id: "recent", title: "Recent")]],
            contents: ["recent": ("Before", "hash-1")],
            updateResult: .failure(.conflict))
        let store = RemoteDocumentStore(api: api)
        let document = try await store.resolve("Recent")

        do {
            try await store.writeMarkdown("After", to: document)
            XCTFail("expected the stale write to be refused")
        } catch TextTextCLIError.documentChanged(let name) {
            XCTAssertEqual(name, "Notes/Recent.textpack")
        } catch {
            XCTFail("expected documentChanged, got \(error)")
        }
    }

    func testSectionEditSendsOnlyTheTargetedBodyAndItsExpectedValue() async throws {
        let notes = folder(id: "notes", name: "Notes", path: "Notes", mode: "notes")
        let markdown = "## Pricing\n\nTen dollars.\n\n## Availability\n\nToday."
        let api = FakeCLISyncAPI(
            workspace: workspace(folders: [notes]),
            manifests: [notes.id: [item(id: "recent", title: "Recent")]],
            contents: ["recent": (markdown, "hash-1")])
        let store = RemoteDocumentStore(api: api)
        let document = try await store.resolve("Recent")
        let current = try await store.readMarkdown(at: document)
        let section = try XCTUnwrap(DocumentSections.find("Pricing", in: current))

        let actor = AgentActor(
            name: "Codex", activity: .edit,
            section: "Pricing", message: "Update pricing",
            itemId: document.itemId)
        try await CLICommandActor.$current.withValue(actor) {
            try await store.replaceSectionBody(
                "Twelve dollars.", section: section, in: document)
        }

        let captured = await api.lastSectionUpdate()
        let request = try XCTUnwrap(captured)
        XCTAssertEqual(request.section, "## Pricing")
        XCTAssertEqual(request.expectedBody, "Ten dollars.")
        XCTAssertEqual(request.replacementBody, "Twelve dollars.")
        XCTAssertEqual(request.hash, "hash-1")
        XCTAssertEqual(request.agentName, "Codex")
        XCTAssertEqual(request.agentIntent, "Update pricing")
    }

    func testCreateUsesTheRequestedFolderAndOneStableIdempotencyKey() async throws {
        let notes = folder(id: "notes", name: "Notes", path: "Notes", mode: "notes")
        let api = FakeCLISyncAPI(
            workspace: workspace(folders: [notes]),
            manifests: [notes.id: []])
        let store = RemoteDocumentStore(api: api)

        let actor = AgentActor(
            name: "Codex", activity: .edit,
            message: "Create field notes")
        let created = try await CLICommandActor.$current.withValue(actor) {
            try await store.create(
                title: "Field notes", body: "A useful observation.", folder: "Notes")
        }

        XCTAssertEqual(created.path, "Notes/Field notes.textpack")
        let capturedRequest = await api.lastCreate()
        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(request.folderPath, notes.path)
        XCTAssertTrue(request.markdown.contains("Field notes"))
        XCTAssertTrue(request.markdown.contains("A useful observation."))
        XCTAssertTrue(request.idempotencyKey.hasPrefix("cli-create-"))
        XCTAssertEqual(request.agentName, "Codex")
        XCTAssertEqual(request.agentIntent, "Create field notes")
    }

    func testCreateInfersArticleKindFromAnExplicitBlogFolder() async throws {
        let blog = folder(id: "blog", name: "Blog", path: "blog", mode: "blog")
        let api = FakeCLISyncAPI(
            workspace: workspace(folders: [blog]),
            manifests: [blog.id: []])
        let store = RemoteDocumentStore(api: api)

        _ = try await store.create(
            title: "Field report", body: "Ready to publish.", folder: "Blog")

        let capturedRequest = await api.lastCreate()
        let request = try XCTUnwrap(capturedRequest)
        XCTAssertEqual(request.folderPath, "blog")
        XCTAssertTrue(request.markdown.contains("type: \"article\""))
        XCTAssertFalse(request.markdown.contains("type: \"note\""))
    }

    func testDeviceCredentialRejectsPlaintextNonLoopbackOrigin() {
        XCTAssertNil(
            DeviceCredentials(
                token: "wsk_secret", serverOrigin: "http://example.com"
            ).validatedServerOrigin)
        XCTAssertNil(
            DeviceCredentials(
                token: "not-a-device-token", serverOrigin: "https://texttext.app"
            ).validatedServerOrigin)
        XCTAssertEqual(
            DeviceCredentials(
                token: "wsk_secret", serverOrigin: "https://texttext.app"
            ).validatedServerOrigin?.absoluteString, "https://texttext.app")
        XCTAssertEqual(
            DeviceCredentials(
                token: "wsk_secret", serverOrigin: "http://127.0.0.1:3000"
            ).validatedServerOrigin?.absoluteString, "http://127.0.0.1:3000")
    }

    func testAgentHeadersRejectOversizedAndControlCharacterValues() {
        XCTAssertEqual(AgentActor.validatedName("  Codex  "), "Codex")
        XCTAssertNil(AgentActor.validatedName(String(repeating: "A", count: 121)))
        XCTAssertNil(AgentActor.validatedName("Codex\u{7f}"))
        XCTAssertEqual(
            AgentActor.validatedIntent("  Tighten this section  "),
            "Tighten this section")
        XCTAssertNil(AgentActor.validatedIntent(String(repeating: "I", count: 501)))
        XCTAssertNil(AgentActor.validatedIntent("intent\nforged-header"))
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-remote-store-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func workspace(folders: [TextTextWorkspaceFolder]) -> TextTextWorkspace {
        TextTextWorkspace(
            blog: TextTextWorkspaceBlog(handle: "ramine", name: "Ramine's blog", username: nil),
            folders: folders)
    }

    private func folder(
        id: String, name: String, path: String, mode: String, parentId: String? = nil
    ) -> TextTextWorkspaceFolder {
        TextTextWorkspaceFolder(
            id: id, name: name, path: path, mode: mode, parentId: parentId)
    }

    private func item(id: String, title: String) -> TextTextManifestItem {
        TextTextManifestItem(
            file: "\(id).textpack", representation: .textpack,
            kind: "note", slug: id, title: title, status: "draft",
            hash: "manifest-\(id)", id: id, date: nil, createdAt: nil,
            updatedAt: nil, url: "/api/sync/v1/files/\(id)")
    }
}

private actor FakeCLISyncAPI: TextTextCLISyncAPI {
    struct UpdateRequest: Sendable {
        let postId: String
        let markdown: String
        let hash: String
        let agentName: String?
        let agentIntent: String?
    }

    struct CreateRequest: Sendable {
        let markdown: String
        let folderPath: String
        let idempotencyKey: String
        let agentName: String?
        let agentIntent: String?
    }

    struct SectionUpdateRequest: Sendable {
        let postId: String
        let section: String
        let expectedBody: String
        let replacementBody: String
        let hash: String
        let agentName: String?
        let agentIntent: String?
    }

    private let workspaceValue: TextTextWorkspace
    private var manifests: [String: [TextTextManifestItem]]
    private let contents: [String: (markdown: String, hash: String)]
    private let updateResult: Result<TextTextAgentCommandReply, TextTextSyncError>
    private var updates: [UpdateRequest] = []
    private var creates: [CreateRequest] = []
    private var sectionUpdates: [SectionUpdateRequest] = []
    private var readCount = 0

    init(
        workspace: TextTextWorkspace,
        manifests: [String: [TextTextManifestItem]],
        contents: [String: (String, String)] = [:],
        updateResult: Result<TextTextAgentCommandReply, TextTextSyncError>? = nil
    ) {
        self.workspaceValue = workspace
        self.manifests = manifests
        self.contents = contents
        self.updateResult =
            updateResult
            ?? .success(
                TextTextAgentCommandReply(
                    item: TextTextAgentCommandItem(id: "updated", title: "Updated", hash: "hash-2"))
            )
    }

    func workspace() async -> Result<TextTextWorkspace, TextTextSyncError> {
        .success(workspaceValue)
    }

    func manifest(folderId: String) async
        -> Result<[TextTextManifestItem], TextTextSyncError>
    {
        .success(manifests[folderId] ?? [])
    }

    func fileContent(
        postId: String, representation: TextTextFileRepresentation
    ) async -> Result<TextTextFileContent, TextTextSyncError> {
        guard let value = contents[postId] else { return .failure(.notFound) }
        return .success(
            TextTextFileContent(
                text: value.markdown, hash: value.hash))
    }

    func agentReadItem(
        postId: String, agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        readCount += 1
        guard let value = contents[postId] else { return .failure(.notFound) }
        return .success(
            TextTextAgentCommandReply(
                item: TextTextAgentCommandItem(
                    id: postId, title: "Recent", hash: value.hash),
                markdown: value.markdown))
    }

    func agentCreateItem(
        markdown: String, folderPath: String, idempotencyKey: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        creates.append(
            CreateRequest(
                markdown: markdown, folderPath: folderPath,
                idempotencyKey: idempotencyKey, agentName: agentName,
                agentIntent: agentIntent))
        let created = Self.item(id: "created", title: "Field notes")
        if let folder = workspaceValue.folders.first(where: { $0.path == folderPath }) {
            manifests[folder.id, default: []].append(created)
        }
        return .success(
            TextTextAgentCommandReply(
                item: TextTextAgentCommandItem(
                    id: "created", title: "Field notes", hash: "hash-created")))
    }

    func agentUpdateItem(
        postId: String, markdown: String, ifMatchHash hash: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        updates.append(
            UpdateRequest(
                postId: postId, markdown: markdown, hash: hash,
                agentName: agentName, agentIntent: agentIntent))
        return updateResult
    }

    func agentUpdateItemSection(
        postId: String, section: String, expectedBody: String,
        replacementBody: String, ifMatchHash hash: String,
        agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        sectionUpdates.append(
            SectionUpdateRequest(
                postId: postId, section: section, expectedBody: expectedBody,
                replacementBody: replacementBody, hash: hash,
                agentName: agentName, agentIntent: agentIntent))
        return updateResult
    }

    func agentAppendItem(
        postId: String, markdown: String, ifMatchHash: String,
        idempotencyKey: String, agentName: String?, agentIntent: String?
    ) async -> Result<TextTextAgentCommandReply, TextTextSyncError> {
        .success(
            TextTextAgentCommandReply(
                item: TextTextAgentCommandItem(
                    id: postId, title: "Recent", hash: "hash-appended")))
    }

    func lastPut() -> UpdateRequest? { updates.last }
    func lastCreate() -> CreateRequest? { creates.last }
    func lastSectionUpdate() -> SectionUpdateRequest? { sectionUpdates.last }
    func commandReadCount() -> Int { readCount }

    private static func item(id: String, title: String) -> TextTextManifestItem {
        TextTextManifestItem(
            file: "\(id).textpack", representation: .textpack,
            kind: "note", slug: id, title: title, status: "draft",
            hash: "manifest-\(id)", id: id, date: nil, createdAt: nil,
            updatedAt: nil, url: "/api/sync/v1/files/\(id)")
    }
}
