import AppKit
import WebKit
import UniformTypeIdentifiers
import TextTextCLICore
import TextTextFileProviderKit
import TextTextWorkspaceCore

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
    private var loaded = false
    private let credentials: LocalVaultConnectionController.CredentialsProvider
    private var connection: LocalVaultConnectionController?
    private var agent: LocalVaultAgentController?
    var onSelectedFolder: (() -> Void)?
    var onSignIn: (() -> Void)?

    init(entry: URL, root initialRoot: URL? = nil,
         credentials: @escaping LocalVaultConnectionController.CredentialsProvider = { nil }) {
        self.entry = entry
        self.credentials = credentials
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760))
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

    func windowWillClose(_ notification: Notification) { agent?.cancel(); agent = nil }
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
        guard let root else { return }
        connection = LocalVaultConnectionController(root: root, credentials: credentials)
        connection?.onChange = { [weak self] state, changed in
            self?.emit("texttext:vault-sync-status", value: state)
            if changed { self?.emit("texttext:vault-changed", value: [:]) }
        }
        emit("texttext:vault-sync-status", value: connection?.status ?? [:])
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
                let created = try files.create(title: title, body: url.absoluteString, kind: "bookmark", sourceURL: url.absoluteString)
                DispatchQueue.main.async { _ = self?.openFile(created); self?.emit("texttext:vault-changed", value: [:]) }
            } catch {
                DispatchQueue.main.async { NSAlert(error: error).runModal() }
            }
        }
    }
    private func importPanel(folder: String, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let root else { completion(.failure(VaultBridgeError("Open a folder first."))); return }
        let panel = NSOpenPanel()
        panel.title = "Import into this folder"
        panel.prompt = "Import"
        panel.canChooseDirectories = false; panel.canChooseFiles = true; panel.allowsMultipleSelection = false
        panel.allowedContentTypes = ["textpack", "textbundle", "md", "markdown"].compactMap { UTType(filenameExtension: $0) }
        panel.begin { [weak self] response in
            guard let self else { completion(.failure(VaultBridgeError("The workspace window closed."))); return }
            guard response == .OK, let source = panel.url else { completion(.success([:])); return }
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
                    return ["file": try Self.payload(store.importFile(from: source, newPath: path))]
                }
                DispatchQueue.main.async { completion(result); self.emit("texttext:vault-changed", value: [:]) }
            }
        }
    }
    func newDocument() { emit("texttext:vault-new", value: [:]) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if let pendingPath { emit("texttext:vault-open", value: ["path": pendingPath]); self.pendingPath = nil }
    }

    private func selectRoot(_ url: URL) throws {
        agent?.stop(); agent = nil
        watcher?.stop()
        if scoped { root?.stopAccessingSecurityScopedResource() }
        scoped = url.startAccessingSecurityScopedResource()
        root = url
        guard FileManager.default.isReadableFile(atPath: url.path) else { throw CocoaError(.fileReadNoPermission) }
        guard let presets = Bundle.main.url(forResource: "StarterTemplates", withExtension: nil) else { throw VaultBridgeError("Starter templates are missing from this app. Reinstall TextText.") }
        try io.sync { _ = try LocalVaultStarter.seed(root: url, presets: presets) }
        openError = nil
        window?.title = url.lastPathComponent + " · TextText"
        watcher = WorkspaceFolderWatcher(path: url.path, queue: .main, latency: 0.5) { [weak self] in
            self?.emit("texttext:vault-changed", value: [:])
            self?.connection?.schedule()
        }
        connection = LocalVaultConnectionController(root: url, credentials: credentials)
        connection?.onChange = { [weak self] state, filesChanged in
            self?.emit("texttext:vault-sync-status", value: state)
            if filesChanged { self?.emit("texttext:vault-changed", value: [:]) }
        }
    }

    func chooseFolder(directory: URL? = nil, completion: ((Result<[String: Any], Error>) -> Void)? = nil) {
        let panel = NSOpenPanel()
        panel.title = "Open workspace folder"
        panel.directoryURL = directory
        panel.prompt = "Open"
        panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.begin { [weak self] response in
            guard let self else { return }
            guard response == .OK, let selected = panel.url else {
                completion?(.failure(CocoaError(.userCancelled))); return
            }
            do {
                let bookmark = try selected.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
                _ = try LocalVaultConfiguration.open(root: selected, bookmarkData: bookmark)
                try self.selectRoot(selected)
                self.onSelectedFolder?()
                self.io.async {
                    let result = Result { try Self.list(root: selected) }
                    DispatchQueue.main.async { completion?(result); self.emit("texttext:vault-changed", value: [:]) }
                }
            } catch { completion?(.failure(error)) }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "localVault", message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.standardizedFileURL == entry.standardizedFileURL,
              let body = message.body as? [String: Any], let id = body["id"] as? String, id.count <= 100,
              let method = body["method"] as? String else { return }
        let params = body["params"] as? [String: Any] ?? [:]
        if method == "open" {
            chooseFolder { [weak self] result in self?.reply(id, result: result) }; return
        }
        if method == "import" {
            importPanel(folder: params["folder"] as? String ?? "") { [weak self] result in self?.reply(id, result: result) }; return
        }
        if method.hasPrefix("agent") {
            guard let root else { reply(id, result: .failure(VaultBridgeError("Open a folder first."))); return }
            if agent == nil {
                agent = LocalVaultAgentController(root: root)
                agent?.onEvent = { [weak self] event in self?.emit("texttext:vault-agent", value: event) }
            }
            do {
                switch method {
                case "agentStatus": break
                case "agentConnect": try agent?.connect()
                case "agentSend": try agent?.send(prompt: Self.string(params, "prompt"), path: params["path"] as? String)
                case "agentCancel": agent?.cancel()
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
        if method == "connection" { reply(id, result: .success(connection?.status ?? ["connected": false, "available": credentials() != nil])); return }
        if method == "connect" {
            guard let connection else { reply(id, result: .failure(VaultBridgeError("Open a folder first."))); return }
            Task { [weak self] in
                do { self?.reply(id, result: .success(try await connection.connect())) }
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
                case "search":
                    let page = try DocumentStore(root: root).searchPage(Self.string(params, "query"), textpacksOnly: true)
                    return ["items": page.items.map { ["path": $0.id, "title": $0.title, "snippet": $0.snippet] },
                        "truncated": page.truncated, "skippedCount": page.skippedCount]
                case "read": return try Self.payload(store.read(path: Self.string(params, "path")))
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
                    while FileManager.default.fileExists(atPath: try store.url(for: path).path) {
                        path = prefix + stem + " \(suffix).textpack"; suffix += 1
                    }
                    let temporary = FileManager.default.temporaryDirectory
                        .appendingPathComponent("texttext-import-\(UUID().uuidString)", isDirectory: true)
                    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: false)
                    defer { try? FileManager.default.removeItem(at: temporary) }
                    let source = temporary.appendingPathComponent(stem + ".textpack")
                    try data.write(to: source, options: .withoutOverwriting)
                    return try Self.payload(store.importFile(from: source, newPath: path))
                case "rename":
                    return try Self.payload(store.rename(path: Self.string(params, "path"),
                        expectedHash: Self.string(params, "hash"), newPath: Self.string(params, "newPath")))
                case "delete":
                    try store.delete(path: Self.string(params, "path"), expectedHash: Self.string(params, "hash"))
                    return [:]
                case "template":
                    let document = try store.read(path: Self.string(params, "path"))
                    return ["path": document.path, "hash": document.hash,
                        "templateJSON": document.contents.templateJSON as Any? ?? NSNull(),
                        "templateAuthoringSourceJSON": document.contents.templateAuthoringSourceJSON as Any? ?? NSNull()]
                case "write":
                    return try Self.payload(store.write(path: Self.string(params, "path"),
                        expectedHash: Self.string(params, "hash"), markdown: Self.string(params, "markdown"),
                        documentJSON: params["documentJSON"] as? String,
                        templateJSON: params["templateJSON"] as? String,
                        templateAuthoringSourceJSON: params["templateAuthoringSourceJSON"] as? String))
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
                        return try Self.payload(store.clone(path: source,
                            sourceHash: params["sourceHash"] as? String,
                            newPath: (folder.flatMap { $0.isEmpty ? nil : $0 + "/" } ?? "") + DocumentCreation.filename(for: uniqueTitle) + ".textpack"))
                    }
                    let kind = params["kind"] as? String ?? "note"
                    guard kind == "note" || kind == "bookmark" else { throw VaultBridgeError("Unsupported capture type.") }
                    let source = params["sourceURL"] as? String
                    if let source {
                        guard let url = URL(string: source), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                              url.host != nil, url.user == nil, url.password == nil else { throw VaultBridgeError("Choose an HTTP or HTTPS link without credentials.") }
                    }
                    let created = try files.create(title: uniqueTitle, body: params["body"] as? String ?? "",
                        folder: folder, kind: kind, sourceURL: source)
                    return try Self.payload(store.read(path: files.relativePath(of: created)))
                default: throw VaultBridgeError("Unknown file operation.")
                }
            }
            var current: [String: Any]?
            if case .failure(LocalVaultDocumentStore.Failure.changed) = result,
               let path = params["path"] as? String {
                current = try? Self.payload(LocalVaultDocumentStore(root: root).read(path: path))
            }
            let conflictCurrent = current
            DispatchQueue.main.async { self?.reply(id, result: result, current: conflictCurrent) }
        }
    }

    private static func string(_ params: [String: Any], _ key: String) throws -> String {
        guard let value = params[key] as? String, value.utf8.count <= 16_000_000 else { throw VaultBridgeError("Missing or oversized \(key).") }
        return value
    }
    private static func list(root: URL) throws -> [String: Any] {
        ["root": root.path, "folders": try LocalVaultStarter.listFolders(root: root), "items": try LocalVaultDocumentStore(root: root).list().map { ["path": $0] }]
    }
    private static func payload(_ document: LocalVaultDocumentStore.Document) -> [String: Any] {
        let contents = document.contents
        return ["path": document.path, "hash": document.hash, "markdown": contents.markdown,
            "documentJSON": contents.documentJSON as Any? ?? NSNull(),
            "templateJSON": contents.templateJSON as Any? ?? NSNull(),
            "templateAuthoringSourceJSON": contents.templateAuthoringSourceJSON as Any? ?? NSNull(),
            "assets": contents.assets.map { ["filename": $0.filename,
                "contentType": $0.contentType ?? "application/octet-stream", "data": $0.data.base64EncodedString(),
                "remoteURL": $0.remoteURL ?? "assets/\($0.filename)"] }]
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
