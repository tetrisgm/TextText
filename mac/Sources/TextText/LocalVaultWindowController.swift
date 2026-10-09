import AppKit
import ImageIO
import WebKit
import UniformTypeIdentifiers
import TextTextCLICore
import TextTextFileProviderKit
import TextTextWorkspaceCore
import TextTextShareCore

/// The existing document editor, bundled locally, talking only to the folder
/// the person selected. Hosted pages cannot invoke this filesystem bridge.
final class LocalVaultWindowController: NSWindowController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    static var entryURL: URL? {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("LocalVault/index.html"),
              FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }
    private let webView: WKWebView
    private let entry: URL
    private let io = DispatchQueue(label: "app.texttext.local-vault", qos: .userInitiated)
    private var root: URL?
    private var scoped = false
    private var watcher: WorkspaceFolderWatcher?
    private var openError: String?
    private var pendingPath: String?
    private var switchingWorkspace = false
    private var loaded = false
    private let credentials: LocalVaultConnectionController.CredentialsProvider
    private var connection: LocalVaultConnectionController?
    private var collaboration: LocalVaultCollaboration?
    private var agent: LocalVaultAgentController?
    var onSelectedFolder: (() -> Void)?
    var onSignIn: (() -> Void)?
    var onSignOut: (() -> Void)?
    var onSettings: (() -> Void)?

    init(entry: URL, root initialRoot: URL? = nil,
         websiteDataStore: WKWebsiteDataStore = .default(),
         collaboration: LocalVaultCollaboration? = nil,
         credentials: @escaping LocalVaultConnectionController.CredentialsProvider = { nil }) {
        self.entry = entry
        self.credentials = credentials
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = websiteDataStore
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760), configuration: configuration)
        let window = NSWindow(contentRect: webView.frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.contentView = webView
        window.title = "TextText"
        window.minSize = NSSize(width: 720, height: 480)
        window.setFrameAutosaveName("TextTextLocalVault")
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.configuration.userContentController.add(VaultMessageProxy(self), name: "localVault")
        do {
            if let initialRoot { try selectRoot(initialRoot) }
            else if let configuration = try LocalVaultConfiguration.load() {
                try selectRoot(configuration.resolvingRoot())
            }
        } catch { openError = error.localizedDescription }
        self.collaboration = collaboration
        webView.loadFileURL(entry, allowingReadAccessTo: entry.deletingLastPathComponent())
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
        guard frame.isMainFrame, frame.request.url?.standardizedFileURL == entry.standardizedFileURL,
              let window else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.png, .jpeg, .gif, .webP]
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }
    deinit { watcher?.stop(); if scoped { root?.stopAccessingSecurityScopedResource() } }

    // AppDelegate retains this window and its WebView after Command-W. Its
    // editor may still drain a local checkpoint and is reused on reopening.
    // Closing a window must not invalidate that editor's native session token.
    func windowWillClose(_ notification: Notification) { agent?.stop(); agent = nil }
    func shutdown() {
        collaboration?.cancelAll(); collaboration = nil
        agent?.stop(); agent = nil
        watcher?.stop(); watcher = nil
        connection?.stop(); connection = nil
    }
    func present() { NSApp.activate(ignoringOtherApps: true); showWindow(nil); window?.makeKeyAndOrderFront(nil) }

    func openFile(_ url: URL) -> Bool {
        guard let root else { return false }
        let path = url.standardizedFileURL.resolvingSymlinksInPath().path
        let prefix = root.standardizedFileURL.resolvingSymlinksInPath().path + "/"
        guard path.hasPrefix(prefix), url.pathExtension.lowercased() == "textpack" else { return false }
        pendingPath = String(path.dropFirst(prefix.count))
        if loaded { emit("texttext:vault-open", value: ["path": pendingPath!]); pendingPath = nil }
        present(); return true
    }
    func credentialsChanged() {
        if let connection { connection.credentialsChanged(); return }
        guard let root else { return }
        connection = LocalVaultConnectionController(root: root, credentials: credentials)
        connection?.onChange = { [weak self] state, changed in
            self?.emit("texttext:vault-sync-status", value: state)
            if changed { self?.emit("texttext:vault-changed", value: [:]) }
        }
        emit("texttext:vault-sync-status", value: connection?.status ?? [:])
        connection?.connectAutomatically()
    }
    func flushForSignOut(_ completion: @escaping (Bool) -> Void) {
        guard loaded else { completion(true); return }
        Task { @MainActor in
            do {
                let value = try await webView.callAsyncJavaScript(
                    "return await window.texttextFlushForSignOut?.() ?? false",
                    arguments: [:], in: nil, contentWorld: .page
                )
                completion(value as? Bool == true)
            } catch {
                completion(false)
            }
        }
    }
    func editHistory(_ direction: String) {
        emit(direction == "redo" ? "texttext:document-redo" : "texttext:document-undo", value: [:])
    }
    func captureURL(_ url: URL) {
        guard let root else { chooseFolder { [weak self] result in if case .success = result { self?.captureURL(url) } }; return }
        io.async { [weak self] in
            do {
                let files = DocumentStore(root: root)
                let stem = url.host ?? "Bookmark"
                var title = stem, suffix = 2
                while FileManager.default.fileExists(atPath: root.appendingPathComponent(DocumentCreation.filename(for: title) + ".textpack").path) {
                    title = "\(stem) \(suffix)"; suffix += 1
                }
                let created = try LocalVaultEditOriginJournal(root: root).recordingNativeSave {
                    let created = try files.create(title: title, body: url.absoluteString, kind: "bookmark", sourceURL: url.absoluteString)
                    return try LocalVaultDocumentStore(root: root).read(path: files.relativePath(of: created))
                }
                DispatchQueue.main.async { _ = self?.openFile(root.appendingPathComponent(created.path)); self?.emit("texttext:vault-changed", value: [:]) }
            } catch {
                DispatchQueue.main.async { NSAlert(error: error).runModal() }
            }
        }
    }
    func fileShareInbox(_ records: [InboxRecord], reader: InboxReader,
                        completion: @escaping ([String]) -> Void) {
        guard let root else { completion(["Open a workspace to file shared items."]); return }
        io.async { [weak self] in
            var failures: [String] = []
            var filed = false
            for record in records {
                do {
                    _ = try LocalShareInboxFiler().file(record, root: root)
                    try reader.deleteConsumed(record)
                    filed = true
                } catch { failures.append(error.localizedDescription) }
            }
            DispatchQueue.main.async {
                if filed { self?.emit("texttext:vault-changed", value: [:]) }
                completion(failures)
            }
        }
    }
    private func importPanel(requestID: String, folder: String, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let root else { completion(.failure(VaultBridgeError("Open a folder first."))); return }
        let panel = NSOpenPanel()
        panel.title = "Import into this folder"
        panel.prompt = "Import"
        panel.canChooseDirectories = false; panel.canChooseFiles = true; panel.allowsMultipleSelection = false
        panel.allowedContentTypes = ["textpack", "textbundle", "md", "markdown"].compactMap { UTType(filenameExtension: $0) }
        panel.begin { [weak self] response in
            guard let self else { completion(.failure(VaultBridgeError("The workspace window closed."))); return }
            guard response == .OK, let source = panel.url else { completion(.success([:])); return }
            self.startNativeOperation(requestID)
            let scoped = source.startAccessingSecurityScopedResource()
            self.io.async {
                defer { if scoped { source.stopAccessingSecurityScopedResource() } }
                let result: Result<[String: Any], Error> = Result {
                    let store = LocalVaultDocumentStore(root: root)
                    let stem = DocumentCreation.filename(for: source.deletingPathExtension().lastPathComponent)
                    let prefix = folder.isEmpty ? "" : folder + "/"
                    var path = prefix + stem + ".textpack", suffix = 2
                    while FileManager.default.fileExists(atPath: try store.url(for: path).path) {
                        path = prefix + stem + " \(suffix).textpack"; suffix += 1
                    }
                    let document = try LocalVaultEditOriginJournal(root: root).recordingNativeSave {
                        try store.importFile(from: source, newPath: path)
                    }
                    return ["file": Self.payload(document)]
                }
                DispatchQueue.main.async { completion(result); self.emit("texttext:vault-changed", value: [:]) }
            }
        }
        beginNativePicker(requestID)
    }
    func newDocument() { emit("texttext:vault-new", value: [:]) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if let pendingPath { emit("texttext:vault-open", value: ["path": pendingPath]); self.pendingPath = nil }
    }

    private func selectRoot(_ url: URL, preparedConnection: LocalVaultConnectionController? = nil, persist: (() throws -> Void)? = nil) throws {
        if connection != nil, root?.standardizedFileURL.resolvingSymlinksInPath() == url.standardizedFileURL.resolvingSymlinksInPath() { return }
        let nextScoped = url.startAccessingSecurityScopedResource()
        do {
            var directory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &directory), directory.boolValue,
                  FileManager.default.isReadableFile(atPath: url.path) else { throw CocoaError(.fileReadNoPermission) }
            _ = try PortableWorkspaceBinding.read(root: url)
            // The persisted selection is the commit point. No active service is
            // retired until validation and the atomic configuration write pass.
            try persist?()
        } catch { if nextScoped { url.stopAccessingSecurityScopedResource() }; throw error }
        collaboration?.cancelAll(); collaboration = nil
        connection?.stop(); connection = nil
        agent?.stop(); agent = nil
        watcher?.stop()
        if scoped { root?.stopAccessingSecurityScopedResource() }
        scoped = nextScoped
        root = url
        // Account workspaces are provisioned once by the server. Selecting a
        // folder must not create another set of local starter identities.
        openError = nil
        window?.title = url.lastPathComponent + " · TextText"
        watcher = WorkspaceFolderWatcher(path: url.path, queue: .main, latency: 0.5) { [weak self] in
            self?.emit("texttext:vault-changed", value: [:])
            self?.connection?.schedule()
        }
        connection = preparedConnection ?? LocalVaultConnectionController(root: url, credentials: credentials)
        connection?.onChange = { [weak self] state, filesChanged in
            self?.emit("texttext:vault-sync-status", value: state)
            if filesChanged { self?.emit("texttext:vault-changed", value: [:]) }
        }
        if preparedConnection != nil { connection?.activate() } else { connection?.connectAutomatically() }
    }

    private func openWorkspace(_ workspaceId: String) async throws -> [String: Any] {
        guard !switchingWorkspace, let oldRoot = root, let existing = connection, let account = credentials() else { throw VaultBridgeError("Open a signed-in workspace first.") }
        switchingWorkspace = true
        defer { switchingWorkspace = false }
        let available = try await existing.availableWorkspaces()
        guard available.contains(where: { $0.id == workspaceId }) else { throw VaultBridgeError("This workspace is unavailable.") }
        if existing.status["workspaceId"] as? String == workspaceId { return Self.withCapabilities(try Self.list(root: oldRoot), existing.capabilities) }
        let binding = try LocalVaultSyncBinding(origin: account.origin, workspaceId: workspaceId)
        let selected = oldRoot.deletingLastPathComponent().appendingPathComponent(workspaceId, isDirectory: true)
        try LocalVaultWorkspaceSelection.prepareFolder(selected, binding: binding)
        let access = selected.startAccessingSecurityScopedResource()
        defer { if access { selected.stopAccessingSecurityScopedResource() } }
        let candidate = LocalVaultConnectionController(root: selected, workspaceId: workspaceId, credentials: credentials)
        var activated = false
        defer { if !activated { candidate.stop() } }
        _ = try await candidate.connect(startSync: false)
        guard root == oldRoot, let current = credentials(), current.origin == account.origin, current.token == account.token else { throw CancellationError() }
        let canLeave = await withCheckedContinuation { continuation in flushForSignOut { continuation.resume(returning: $0) } }
        guard canLeave else { throw VaultBridgeError("Finish saving this workspace before switching.") }
        guard root == oldRoot, let current = credentials(), current.origin == account.origin, current.token == account.token else { throw CancellationError() }
        let listing = Self.withCapabilities(try Self.list(root: selected), candidate.capabilities)
        let bookmark = try selected.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
        try selectRoot(selected, preparedConnection: candidate) {
            _ = try LocalVaultConfiguration.openSelection(root: selected, bookmarkData: bookmark)
        }
        activated = true
        pendingPath = nil
        onSelectedFolder?()
        emit("texttext:vault-changed", value: [:])
        return listing
    }

    func chooseFolder(requestID: String? = nil, directory: URL? = nil, completion: ((Result<[String: Any], Error>) -> Void)? = nil) {
        let panel = NSOpenPanel()
        panel.title = "Open workspace folder"
        panel.directoryURL = directory
        panel.prompt = "Open"
        panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.begin { [weak self] response in
            guard let self else { return }
            guard response == .OK, let selected = panel.url else {
                _ = try? LocalVaultConfiguration.openSelection(root: nil)
                completion?(.failure(CocoaError(.userCancelled))); return
            }
            if let requestID { self.startNativeOperation(requestID) }
            do {
                let bookmark = try selected.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
                try self.selectRoot(selected, persist: {
                do {
                    _ = try LocalVaultConfiguration.openSelection(root: selected, bookmarkData: bookmark)
                } catch let error as LocalVaultConfigurationError {
                    guard case .recoveryRequired(let configURL, let reason) = error else { throw error }
                    let alert = NSAlert()
                    alert.alertStyle = .warning
                    alert.messageText = "TextText needs to recover its folder settings"
                    alert.informativeText = "The saved settings at \(configURL.path) cannot be read safely (\(reason)). TextText can keep a recovery copy and save the folder you selected. Your notes stay in their folder."
                    alert.addButton(withTitle: "Keep Backup and Continue")
                    alert.addButton(withTitle: "Cancel")
                    guard alert.runModal() == .alertFirstButtonReturn else {
                        throw CocoaError(.userCancelled)
                    }
                    _ = try LocalVaultConfiguration.openSelection(
                        root: selected,
                        bookmarkData: bookmark,
                        replacingUnreadableConfiguration: true
                    )
                }
                })
                self.onSelectedFolder?()
                self.io.async {
                    let result = Result { try Self.list(root: selected) }
                    DispatchQueue.main.async { completion?(result); self.emit("texttext:vault-changed", value: [:]) }
                }
            } catch { completion?(.failure(error)) }
        }
        if let requestID { beginNativePicker(requestID) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "localVault", message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.standardizedFileURL == entry.standardizedFileURL,
              let body = message.body as? [String: Any], let id = body["id"] as? String, id.count <= 100,
              let method = body["method"] as? String else { return }
        let params = body["params"] as? [String: Any] ?? [:]
        if method == "workspacesList" {
            guard let connection else { reply(id, result: .failure(VaultBridgeError("Open a workspace first."))); return }
            Task { @MainActor [weak self] in
                do {
                    let choices = try await connection.availableWorkspaces()
                    guard self?.connection === connection else { throw CancellationError() }
                    self?.reply(id, result: .success(["currentId": connection.status["workspaceId"] ?? NSNull(), "workspaces": choices.map(\.dictionary)]))
                } catch { self?.reply(id, result: .failure(error)) }
            }
            return
        }
        if method == "workspaceOpen" {
            guard params.count == 1, let workspaceId = params["workspaceId"] as? String else { reply(id, result: .failure(VaultBridgeError("Choose a workspace."))); return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                do { self.reply(id, result: .success(try await self.openWorkspace(workspaceId))) }
                catch { self.reply(id, result: .failure(error)) }
            }
            return
        }
        if method == "trashReconcile" {
            guard let engine = connection?.collaborationEngine, root != nil,
                  let lifecycle = params["operationId"] as? String,
                  let itemId = params["itemId"] as? String,
                  let path = params["relativePath"] as? String else {
                reply(id, result: .failure(VaultBridgeError("Open a connected workspace first."))); return
            }
            Task { [weak self] in
                do {
                    try await engine.reconcileRestored(itemId: itemId, path: path, lifecycle: lifecycle)
                    self?.reply(id, result: .success([:]))
                    self?.emit("texttext:vault-changed", value: [:])
                } catch { self?.reply(id, result: .failure(error)) }
            }
            return
        }
        if ["folderMoveReview", "trashList", "trashRestore", "accountRead", "collaborationConfig", "collaborationRead", "collaborationPush", "collaborationCancel", "collaborationOpen", "collaborationCheckpoint", "collaborationClose", "collaborationRecover", "presenceRead", "presenceJoin", "presenceUpdate", "presenceLeave", "shareList", "shareInvite", "shareRole", "shareRevoke", "commentsRead", "commentsAdd", "commentsResolve", "publicationRead", "publicationSet", "feedDiscover", "feedRead", "feedEntry"].contains(method) {
            if method == "collaborationCancel" {
                if let requestId = params["requestId"] as? String, requestId.count <= 100 { collaboration?.cancel(requestId) }
                reply(id, result: .success([:])); return
            }
            guard let root else {
                if method == "collaborationConfig" { emit("texttext:vault-reply", value: ["id": id, "result": NSNull()]) }
                else { reply(id, result: .failure(VaultBridgeError("Open a workspace folder first."))) }
                return
            }
            if collaboration == nil {
                collaboration = LocalVaultCollaboration(credentials: credentials,
                    engine: { [weak self] in self?.connection?.collaborationEngine },
                    didRelease: { [weak self] in self?.connection?.schedule() })
            }
            collaboration?.start(id: id, method: method, params: params, root: root) { [weak self] result in
                switch result {
                case .success(let value): self?.emit("texttext:vault-reply", value: ["id": id, "result": value as Any? ?? NSNull()])
                case .failure(let error):
                    let code = Self.collaborationErrorCode(error, method: method)
                    var detail: [String: Any] = ["code": code, "message": error.localizedDescription]
                    if let status = (error as? LocalVaultCollaborationError)?.status { detail["status"] = status }
                    if let path = (error as? LocalVaultCollaborationError)?.path { detail["path"] = path }
                    self?.emit("texttext:vault-reply", value: ["id": id, "error": detail])
                }
            }
            return
        }
        if method == "open" {
            chooseFolder(requestID: id) { [weak self] result in self?.reply(id, result: result) }; return
        }
        if method == "import" {
            importPanel(requestID: id, folder: params["folder"] as? String ?? "") { [weak self] result in self?.reply(id, result: result) }; return
        }
        if method.hasPrefix("agent") {
            guard let root else { reply(id, result: .failure(VaultBridgeError("Open a folder first."))); return }
            if agent == nil {
                agent = LocalVaultAgentController(root: root)
                agent?.onEvent = { [weak self] event in self?.emit("texttext:vault-agent", value: event) }
                agent?.onFilesChanged = { [weak self] in
                    self?.emit("texttext:vault-changed", value: [:])
                    self?.connection?.schedule()
                }
            }
            do {
                switch method {
                case "agentStatus": try agent?.restoreConnectionIfNeeded()
                case "agentConnect": try agent?.connect()
                case "agentDisconnect": try agent?.disconnect()
                case "agentSend": try agent?.send(taskID: Self.string(params, "taskId"),
                    prompt: Self.string(params, "prompt"), path: params["path"] as? String,
                    folderPath: params["folderPath"] as? String,
                    customizing: params["customizing"] as? Bool ?? false,
                    imageURL: params["imageUrl"] as? String)
                case "agentProposalResult":
                    guard let valid = params["valid"] as? Bool else { throw VaultBridgeError("Provide the template validation result.") }
                    try agent?.proposalResult(taskID: Self.string(params, "taskId"),
                        proposalID: Self.string(params, "proposalId"), valid: valid,
                        message: params["message"] as? String)
                case "agentCancel": try agent?.cancel(taskID: Self.string(params, "taskId"))
                default: throw VaultBridgeError("Unknown agent operation.")
                }
                reply(id, result: .success(agent?.status ?? [:]))
            } catch { reply(id, result: .failure(error)) }
            return
        }
        if method == "extractArticle" {
            guard let account = credentials(), let source = params["sourceURL"] as? String, source.utf8.count <= 4096 else {
                reply(id, result: .failure(VaultBridgeError("Sign in to TextText to capture the article. Your link is saved on this Mac."))); return
            }
            Task { [weak self] in
                do {
                    _ = try LocalVaultSyncBinding(origin: account.origin, workspaceId: "capture")
                    var request = URLRequest(url: account.origin.appendingPathComponent("api/vault/extract"), timeoutInterval: 25)
                    request.httpMethod = "POST"
                    request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization")
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try JSONSerialization.data(withJSONObject: ["sourceURL": source])
                    let (data, response) = try await URLSession.shared.data(for: request)
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= 4_000_000,
                          let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                        throw VaultBridgeError("This article could not be captured. Your link is saved; open the original or retry.")
                    }
                    self?.reply(id, result: .success(result))
                } catch { self?.reply(id, result: .failure(error)) }
            }
            return
        }
        if method == "signIn" { onSignIn?(); reply(id, result: .success([:])); return }
        if method == "signOut" { onSignOut?(); reply(id, result: .success([:])); return }
        if method == "settings" { onSettings?(); reply(id, result: .success([:])); return }
        if method == "connection" { reply(id, result: .success(connection?.status ?? ["connected": false, "available": credentials() != nil])); return }
        if method == "connect" {
            guard let connection else { reply(id, result: .failure(VaultBridgeError("Open a folder first."))); return }
            Task { [weak self] in
                do { self?.reply(id, result: .success(try await connection.connect(allowRebind: params["allowRebind"] as? Bool == true))) }
                catch { self?.reply(id, result: .failure(error)) }
            }
            return
        }
        if method == "recovery" {
            if let root {
                let recovery = root.appendingPathComponent(".texttext/conflicts")
                if FileManager.default.fileExists(atPath: recovery.path) { NSWorkspace.shared.open(recovery) }
            }
            reply(id, result: .success([:])); return
        }
        if method == "sync" { connection?.schedule(); reply(id, result: .success(connection?.status ?? [:])); return }
        if method == "openWeb", let raw = connection?.status["webURL"] as? String, let url = URL(string: raw) {
            NSWorkspace.shared.open(url); reply(id, result: .success([:])); return
        }
        guard let root else {
            if method == "list", openError == nil { reply(id, result: .success(["root": "", "items": []])); return }
            reply(id, result: .failure(VaultBridgeError(openError ?? "Open a workspace folder first."))); return
        }
        io.async { [weak self] in
            let result: Result<[String: Any], Error> = Result {
                let store = LocalVaultDocumentStore(root: root)
                switch method {
                case "list": return try Self.list(root: root)
                case "keptFeedEntries":
                    let entries = try store.keptFeedEntries()
                    return ["hashes": entries.compactMap { $0["hash"] }.sorted(), "entries": entries]
                case "readFeedEntries":
                    let entries = try store.readFeedEntries()
                    return ["hashes": entries.compactMap { $0["hash"] }.sorted(), "entries": entries]
                case "folderViews": return ["files": try store.folderViews(folder: Self.string(params, "folder"))]
                case "search":
                    let folder = params["folder"] as? String
                    let prefix = ["Bookmarks", "Notes"].contains(folder ?? "") ? folder.map { "\($0)/" } : nil
                    let page = try DocumentStore(root: root).searchPage(Self.string(params, "query"), textpacksOnly: true, folderPrefix: prefix)
                    return ["items": page.items.map { ["path": $0.id, "title": $0.title, "snippet": $0.snippet] },
                        "truncated": page.truncated, "skippedCount": page.skippedCount]
                case "read": return try Self.payload(store.read(path: Self.string(params, "path")))
                case "resolveItemId":
                    guard let path = try store.path(forItemId: Self.string(params, "itemId")) else {
                        throw VaultBridgeError("This linked card is no longer in the workspace.")
                    }
                    return ["path": path]
                case "recoveryList":
                    let page = try store.recoveryList(path: params["path"] as? String)
                    return ["entries": page.entries.map { ["id": $0.id, "path": $0.path, "kind": $0.kind, "savedAt": $0.savedAt, "hash": $0.hash] }, "truncated": page.truncated]
                case "recoveryRead":
                    let recovered = try store.recoveryRead(id: Self.string(params, "id"))
                    var value = Self.payload(recovered.document)
                    value["data"] = recovered.data.base64EncodedString()
                    return value
                case "preview":
                    return try autoreleasepool {
                        let path = try Self.string(params, "path")
                        let metadataOnly = params["metadataOnly"] as? Bool == true
                        return try Self.preview(metadataOnly ? store.readMetadata(path: path) : store.read(path: path), metadataOnly: metadataOnly)
                    }
                case "importPack":
                    let maximumSize = 32 * 1024 * 1024
                    guard let encoded = params["data"] as? String,
                          encoded.utf8.count <= ((maximumSize + 2) / 3) * 4,
                          let data = Data(base64Encoded: encoded), !data.isEmpty,
                          data.count <= maximumSize else {
                        throw VaultBridgeError("Choose a valid TextPack no larger than 32 MiB.")
                    }
                    let stem = DocumentCreation.filename(for: try Self.string(params, "title"))
                    let folder = try Self.string(params, "folder")
                    let prefix = folder.isEmpty ? "" : folder + "/"
                    var path = prefix + stem + ".textpack", suffix = 2
                    if let exact = params["exactPath"] as? String, exact != path { throw VaultBridgeError("The folder view destination does not match its folder.") }
                    while FileManager.default.fileExists(atPath: try store.url(for: path).path) {
                        if params["exactPath"] != nil { throw VaultBridgeError("A file already occupies the folder view path.") }
                        path = prefix + stem + " \(suffix).textpack"; suffix += 1
                    }
                    let temporary = FileManager.default.temporaryDirectory
                        .appendingPathComponent("texttext-import-\(UUID().uuidString)", isDirectory: true)
                    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: false)
                    defer { try? FileManager.default.removeItem(at: temporary) }
                    let source = temporary.appendingPathComponent(stem + ".textpack")
                    try data.write(to: source, options: .withoutOverwriting)
                    return try Self.payload(LocalVaultEditOriginJournal(root: root).recordingNativeSave {
                        try store.importFile(from: source, newPath: path)
                    })
                case "rename":
                    return try Self.payload(store.rename(path: Self.string(params, "path"),
                        expectedHash: Self.string(params, "hash"), newPath: Self.string(params, "newPath")))
                case "delete":
                    try store.delete(path: Self.string(params, "path"), expectedHash: Self.string(params, "hash"))
                    return [:]
                case "template":
                    let document = try store.readMetadata(path: Self.string(params, "path"), includeTemplate: true)
                    var preview: [String: String] = [:]
                    if let raw = document.contents.documentJSON, raw.utf8.count <= 256 * 1024,
                       let snapshot = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any],
                       let content = snapshot["content"] as? [String: Any] {
                        for key in ["title", "subtitle", "body"] {
                            if let value = content[key] as? String { preview[key] = String(value.prefix(180)) }
                        }
                        if let fields = content["fields"] as? [String: Any], let url = fields["sourceUrl"] as? String {
                            preview["sourceUrl"] = String(url.prefix(512))
                        }
                        if let tag = (content["tags"] as? [String])?.first { preview["tag"] = String(tag.prefix(80)) }
                    }
                    return ["path": document.path, "hash": document.hash,
                        "preview": preview,
                        "templateJSON": document.contents.templateJSON as Any? ?? NSNull(),
                        "templateAuthoringSourceJSON": document.contents.templateAuthoringSourceJSON as Any? ?? NSNull()]
                case "write":
                    let expectedHash = try Self.string(params, "hash")
                    return try Self.payload(LocalVaultEditOriginJournal(root: root).recordingNativeSave {
                        try store.write(path: Self.string(params, "path"),
                            expectedHash: expectedHash, markdown: Self.string(params, "markdown"),
                            documentJSON: params["documentJSON"] as? String,
                            templateJSON: params["templateJSON"] as? String,
                            templateAuthoringSourceJSON: params["templateAuthoringSourceJSON"] as? String,
                            projectionJSON: params["projectionJSON"] as? String,
                            addedAssets: try Self.pastedAssets(params))
                    })
                case "create":
                    let files = DocumentStore(root: root)
                    let title = try Self.string(params, "title")
                    let folder = params["folder"] as? String
                    var uniqueTitle = title
                    var suffix = 2
                    while FileManager.default.fileExists(atPath: try store.url(for:
                        (folder.flatMap { $0.isEmpty ? nil : $0 + "/" } ?? "") + DocumentCreation.filename(for: uniqueTitle) + ".textpack").path) {
                        uniqueTitle = "\(title) \(suffix)"; suffix += 1
                    }
                    let destination = try store.url(for:
                        (folder.flatMap { $0.isEmpty ? nil : $0 + "/" } ?? "") + DocumentCreation.filename(for: uniqueTitle) + ".textpack")
                    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                    if let source = params["sourcePath"] as? String {
                        return try Self.payload(LocalVaultEditOriginJournal(root: root).recordingNativeSave {
                            try store.clone(path: source, sourceHash: params["sourceHash"] as? String,
                                newPath: (folder.flatMap { $0.isEmpty ? nil : $0 + "/" } ?? "") + DocumentCreation.filename(for: uniqueTitle) + ".textpack",
                                documentJSON: params["documentJSON"] as? String,
                                templateJSON: params["templateJSON"] as? String,
                                templateAuthoringSourceJSON: params["templateAuthoringSourceJSON"] as? String)
                        })
                    }
                    let kind = params["kind"] as? String ?? "note"
                    guard kind == "note" || kind == "bookmark" else { throw VaultBridgeError("Unsupported capture type.") }
                    let source = params["sourceURL"] as? String
                    if let source {
                        guard let url = URL(string: source), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                              url.host != nil, url.user == nil, url.password == nil else { throw VaultBridgeError("Choose an HTTP or HTTPS link without credentials.") }
                    }
                    return try Self.payload(LocalVaultEditOriginJournal(root: root).recordingNativeSave {
                        let created = try files.create(title: uniqueTitle, body: params["body"] as? String ?? "",
                            folder: folder, kind: kind, sourceURL: source)
                        return try store.read(path: files.relativePath(of: created))
                    })
                default: throw VaultBridgeError("Unknown file operation.")
                }
            }
            var current: [String: Any]?
            if case .failure(LocalVaultDocumentStore.Failure.changed) = result,
               let path = params["path"] as? String {
                current = try? Self.payload(LocalVaultDocumentStore(root: root).read(path: path))
            }
            let conflictCurrent = current
            DispatchQueue.main.async {
                guard self?.root == root else { self?.reply(id, result: .failure(CancellationError())); return }
                let decorated = result.map { value in
                    method == "list" ? Self.withCapabilities(value, self?.connection?.capabilities) : value
                }
                self?.reply(id, result: decorated, current: conflictCurrent)
            }
        }
    }
    static func collaborationErrorCode(_ error: Error, method: String) -> String {
        if let typed = error as? LocalVaultCollaborationError { return typed.code }
        if ["collaborationOpen", "collaborationCheckpoint"].contains(method), let sync = error as? LocalVaultSyncFailure, case .changed = sync { return "local_changed" }
        if error is CancellationError || (error as? URLError)?.code == .cancelled { return "cancelled" }
        return "503"
    }

    private static func string(_ params: [String: Any], _ key: String) throws -> String {
        guard let value = params[key] as? String, value.utf8.count <= 16_000_000 else { throw VaultBridgeError("Missing or oversized \(key).") }
        return value
    }
    private static func pastedAssets(_ params: [String: Any]) throws -> [TextTextTextBundleAsset] {
        guard let raw = params["addedAssets"] else { return [] }
        guard let values = raw as? [[String: Any]], values.count <= 16 else {
            throw VaultBridgeError("Invalid pasted image data.")
        }
        let limit = 20 * 1024 * 1024
        var total = 0
        return try values.map { value in
            guard let filename = value["filename"] as? String,
                  TextTextTextBundlePackage.isSafeAssetFilename(filename),
                  let encoded = value["data"] as? String, !encoded.isEmpty,
                  encoded.utf8.count <= ((limit + 2) / 3) * 4,
                  let data = Data(base64Encoded: encoded), !data.isEmpty,
                  data.count <= limit,
                  let declared = value["contentType"] as? String,
                  let detected = pastedImageType(data), declared == detected.contentType,
                  detected.extensions.contains((filename as NSString).pathExtension.lowercased()) else {
                throw VaultBridgeError("Invalid pasted image data.")
            }
            total += data.count
            guard total <= 40 * 1024 * 1024 else {
                throw VaultBridgeError("Pasted images exceed 40 MiB.")
            }
            var remoteURL: String?
            if let raw = value["remoteURL"] as? String {
                guard raw.utf8.count <= 4096, let url = URL(string: raw),
                      ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                      url.host != nil, url.user == nil, url.password == nil else {
                    throw VaultBridgeError("Invalid pasted image data.")
                }
                remoteURL = url.absoluteString
            } else if value["remoteURL"] != nil {
                throw VaultBridgeError("Invalid pasted image data.")
            }
            return TextTextTextBundleAsset(filename: filename, data: data,
                contentType: detected.contentType, remoteURL: remoteURL)
        }
    }
    private static func pastedImageType(_ data: Data) -> (contentType: String, extensions: Set<String>)? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]) {
            return ("image/png", ["png"])
        }
        if bytes.starts(with: [255, 216, 255]) { return ("image/jpeg", ["jpg", "jpeg"]) }
        if bytes.count >= 6, String(bytes: bytes.prefix(6), encoding: .ascii).map({ ["GIF87a", "GIF89a"].contains($0) }) == true {
            return ("image/gif", ["gif"])
        }
        if bytes.count >= 12,
           String(bytes: bytes[0..<4], encoding: .ascii) == "RIFF",
           String(bytes: bytes[8..<12], encoding: .ascii) == "WEBP" {
            return ("image/webp", ["webp"])
        }
        return nil
    }
    private static func list(root: URL) throws -> [String: Any] {
        ["root": root.path, "folders": try LocalVaultStarter.listFolders(root: root), "items": try LocalVaultDocumentStore(root: root).list().map { ["path": $0] }]
    }
    private static func withCapabilities(_ listing: [String: Any], _ capability: LocalVaultSyncCapabilities?) -> [String: Any] {
        var value = listing
        value["fullAccess"] = capability?.fullAccess ?? false
        value["canCreateContent"] = capability?.canCreateContent ?? false
        value["writableFolders"] = capability?.writableFolders ?? []
        value["items"] = (listing["items"] as? [[String: Any]] ?? []).map { row in
            var row = row
            row["canEditContent"] = (row["path"] as? String).map { capability?.canEdit(path: $0) ?? false } ?? false
            if let path = row["path"] as? String, let identity = capability?.pathIdentities?[path] {
                row["itemId"] = identity
            }
            return row
        }
        return value
    }

    private static func payload(_ document: LocalVaultDocumentStore.Document) -> [String: Any] {
        let contents = document.contents
        return ["path": document.path, "hash": document.hash, "markdown": contents.markdown,
            "documentJSON": contents.documentJSON as Any? ?? NSNull(),
            "templateJSON": contents.templateJSON as Any? ?? NSNull(),
            "templateAuthoringSourceJSON": contents.templateAuthoringSourceJSON as Any? ?? NSNull(),
            "projectionJSON": contents.projectionJSON as Any? ?? NSNull(),
            "assets": contents.assets.map { ["filename": $0.filename,
                "contentType": $0.contentType ?? "application/octet-stream", "data": $0.data.base64EncodedString(),
                "remoteURL": $0.remoteURL ?? "assets/\($0.filename)"] }]
    }
    static func preview(_ document: LocalVaultDocumentStore.Document, metadataOnly: Bool = false) throws -> [String: Any] {
        let contents = document.contents
        let snapshot = contents.documentJSON.flatMap {
            (try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any]
        }
        let content = (snapshot?["schemaVersion"] as? Int) == 1
            ? snapshot?["content"] as? [String: Any] : nil
        // text.md can be edited outside the app without updating document.json.
        let markdown = TextTextMarkdownPreviewRenderer.parse(contents.markdown)
        func bounded(_ value: String, to count: Int) -> String {
            let text = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            // A single grapheme can contain arbitrarily many combining scalars.
            let byteBounded = String(decoding: text.utf8.prefix(8_192), as: UTF8.self)
            return String(byteBounded.prefix(count))
        }
        func rawBounded(_ value: String, to count: Int) -> String {
            String(String(decoding: value.utf8.prefix(8192), as: UTF8.self).prefix(count))
        }
        let title = markdown.frontMatter["title"] ?? content?["title"] as? String
            ?? URL(fileURLWithPath: document.path).deletingPathExtension().lastPathComponent
        var result: [String: Any] = ["title": rawBounded(title, to: 240),
                                   "excerpt": bounded(markdown.body, to: 400)]
        if let publishedAt = document.publishedAt { result["publishedAt"] = publishedAt }
        if !metadataOnly { result["cardBody"] = rawBounded(markdown.body, to: 1200) }
        var fields: [String: Any] = [:]
        for (key, value) in (content?["fields"] as? [String: Any] ?? [:]).sorted(by: { $0.key < $1.key }).prefix(64) where key.utf8.count <= 120 {
            if let text = value as? String { fields[key] = rawBounded(text, to: 2048) }
            else if value is NSNumber || value is NSNull { fields[key] = value }
        }
        let originalFields = content?["fields"] as? [String: Any] ?? [:]
        var incomplete: [String] = []
        if title != result["title"] as? String { incomplete.append("title") }
        if markdown.body != result["excerpt"] as? String { incomplete.append("body") }
        for (key, value) in originalFields.sorted(by: { $0.key < $1.key }) {
            let changed: Bool
            if let text = value as? String { changed = fields[key] as? String != text }
            else { changed = fields[key] == nil }
            if changed { incomplete.append("content.fields." + key) }
            if incomplete.count > 2048 { break }
        }
        let originalTags = content?["tags"] as? [String] ?? []
        let tags = originalTags.prefix(100).map { rawBounded($0, to: 120) }.filter { !$0.isEmpty }
        if tags != originalTags { incomplete.append("tags") }
        let originalSubtitle = content?["subtitle"] as? String
        let subtitle = originalSubtitle.map { rawBounded($0, to: 300) }
        if subtitle != originalSubtitle { incomplete.append("subtitle") }
        result["incompleteFields"] = incomplete.count > 2048 ? ["*"] : incomplete
        if !incomplete.isEmpty { result["metadataTruncated"] = true }
        var projectedContent: [String: Any] = ["title": result["title"]!, "body": result["excerpt"]!, "fields": fields, "tags": tags, "assets": []]
        if let subtitle { projectedContent["subtitle"] = subtitle }
        var projectedTemplate: [String: Any] = ["id": "texttext.note", "version": 1]
        if let presentation = snapshot?["presentation"] as? [String: Any],
           let reference = presentation["template"] as? [String: Any],
           let id = reference["id"] as? String, id.range(of: "^[a-z][a-z0-9.-]{2,159}$", options: .regularExpression) != nil,
           let version = reference["version"] as? Int, version > 0 {
            projectedTemplate = ["id": id, "version": version]
        }
        result["document"] = ["schemaVersion": 1,
            "content": projectedContent,
            "presentation": ["template": projectedTemplate, "theme": [:]] as [String: Any]] as [String: Any]
        if let fields = content?["fields"] as? [String: Any],
           let raw = fields["sourceUrl"] as? String, raw.utf8.count <= 4096,
           let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
           url.host != nil, url.user == nil, url.password == nil {
            result["sourceURL"] = raw
        }
        if let assets = content?["assets"] as? [[String: Any]],
           let first = assets.first(where: {
               ($0["kind"] as? String) == "image" &&
               ($0["src"] as? String) == (originalFields["texttextFeaturedImage"] as? String) &&
               ((($0["src"] as? String).map { markdown.body.contains($0) } ?? false) ||
                ($0["src"] as? String) == (originalFields["cover"] as? String))
           }) ?? assets.first(where: { ($0["kind"] as? String) == "image" }) {
            func embedded(_ reference: String?) -> TextTextTextBundleAsset? {
                guard let reference else { return nil }
                return contents.assets.first {
                    reference == "assets/\($0.filename)" || reference == $0.remoteURL
                }
            }
            // Resolve only bytes carried inside the package, including a poster
            // whose canonical URL happens to be remote. Never fetch that URL.
            let asset = embedded(first["poster"] as? String) ?? embedded(first["src"] as? String)
            if let asset, let image = previewImage(asset.data) { result["image"] = image }
            if assets.filter({ ($0["kind"] as? String) == "image" }).count > 1 {
                var images: [[String: String]] = []
                for entry in assets.filter({ ($0["kind"] as? String) == "image" }).prefix(8) {
                    let source = embedded(entry["poster"] as? String) ?? embedded(entry["src"] as? String)
                    if let source, let image = previewImage(source.data, maximumPixelSize: 280) { images.append(image) }
                }
                if images.count > 1 { result["images"] = images }
            }
        }
        try fitPreviewImages(&result)
        return result
    }
    static func fitPreviewImages(_ result: inout [String: Any], byteLimit: Int = 512 * 1024) throws {
        while try JSONSerialization.data(withJSONObject: result).count > byteLimit,
              let images = result["images"] as? [[String: String]], !images.isEmpty {
            // Keep the primary thumbnail when a multi-image pack exceeds the
            // bridge budget, and retain as many grid tiles as will fit.
            if images.count <= 2 { result.removeValue(forKey: "images") }
            else { result["images"] = Array(images.dropLast()) }
        }
        if try JSONSerialization.data(withJSONObject: result).count > byteLimit {
            result.removeValue(forKey: "image")
        }
    }
    private static func previewImage(_ data: Data, maximumPixelSize: Int = 480) -> [String: String]? {
        guard let source = CGImageSourceCreateWithData(data as CFData,
                [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 16_000_000 / height,
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
                kCGImageSourceShouldCacheImmediately: true,
              ] as CFDictionary) else { return nil }
        let encoded = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(encoded, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, thumbnail,
            [kCGImageDestinationLossyCompressionQuality: 0.75] as CFDictionary)
        guard CGImageDestinationFinalize(destination), encoded.length <= 300 * 1024 else { return nil }
        return ["data": (encoded as Data).base64EncodedString(), "contentType": "image/jpeg"]
    }
    private func reply(_ id: String, result: Result<[String: Any], Error>, current: [String: Any]? = nil) {
        switch result {
        case .success(let value): emit("texttext:vault-reply", value: ["id": id, "result": value])
        case .failure(let error):
            let conflict = (error as? LocalVaultDocumentStore.Failure).map { if case .changed = $0 { return true }; return false } ?? false
            var detail: [String: Any] = ["code": conflict ? "conflict" : "file-error", "message": error.localizedDescription]
            if let current { detail["current"] = current }
            emit("texttext:vault-reply", value: ["id": id, "error": detail])
        }
    }
    private func startNativeOperation(_ id: String) {
        emit("texttext:vault-operation-start", value: ["id": id])
    }
    private func beginNativePicker(_ id: String) {
        emit("texttext:vault-picker-open", value: ["id": id])
    }
    private func emit(_ event: String, value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(event)',{detail:\(json)}))", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.standardizedFileURL == entry.standardizedFileURL { decisionHandler(.allow); return }
        if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
}

private struct VaultBridgeError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
private final class VaultMessageProxy: NSObject, WKScriptMessageHandler {
    weak var owner: LocalVaultWindowController?
    init(_ owner: LocalVaultWindowController) { self.owner = owner }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.userContentController(controller, didReceive: message)
    }
}
