import Foundation
import AppKit
import OSLog
import TextTextCLICore
import TextTextFileProviderKit
import TextTextWorkspaceCore

protocol LocalVaultAgentServer: AnyObject {
    var onEvent: ((CodexAppServerMessage) -> Void)? { get set }
    var onExit: ((Int32) -> Void)? { get set }
    func start() throws
    func stop()
    func send(id: String, method: String, params: [String: Any]) throws
    func notify(method: String, params: [String: Any]) throws
    func respond(id: AnyHashable, result: [String: Any]) throws
}

extension CodexAppServerController: LocalVaultAgentServer {}

/// Reuses the existing signed-in runtime, but every workspace tool reads or
/// writes the selected folder. No hosted workspace command is involved.
@MainActor
final class LocalVaultAgentController {
    private static let log = Logger(subsystem: "app.texttext.mac", category: "local-vault-agent")
    var onEvent: (([String: Any]) -> Void)?
    var onFilesChanged: (() -> Void)?
    private(set) var status: [String: Any] = ["state": "disconnected"]
    private let root: URL
    private let files: DispatchQueue
    private let makePresencePublisher: () -> PresencePublisher
    private let makeServer: (() throws -> any LocalVaultAgentServer)?
    private let cancellationTimeout: TimeInterval
    private var ownsProfile: Bool
    private var server: (any LocalVaultAgentServer)?
    private struct PendingRequest {
        let method: String
        let taskID: String?
        let taskInstanceID: UUID?
    }
    private var pending: [String: PendingRequest] = [:]
    private var disabledMCPServers: [String]?
    private var accountEmail: String?
    private var connectionDiagnosticID = LocalVaultAgentController.makeDiagnosticID()
    private var busy = false
    private struct PendingProposal {
        let requestID: AnyHashable
        let value: String
        let taskID: String
    }
    private struct ToolRequestID: @unchecked Sendable {
        let rawValue: AnyHashable
    }
    private var pendingProposals: [String: PendingProposal] = [:]
    private var loginID: String?
    private var attemptedLogin = false
    private var disconnecting = false
    private var deadline: DispatchWorkItem?
    private var generation = UUID()
    private var phases: [String: CodexAgentMessage.Phase] = [:]
    private struct ActiveTask {
        let instanceID: UUID
        let taskID: String
        let diagnosticID: String
        let prompt: String
        let access: LocalVaultAgentAccess
        let fileFence: LocalVaultAgentCancellation
        var threadID: String?
        var turnID: String?
        var cancelRequested = false
        var interruptSent = false
    }
    private var activeTask: ActiveTask?
    private static let cancellationMessage = "Stopped. Any save that already finished is preserved."
    var activeTaskIdentifiers: (taskID: String, threadID: String?, turnID: String?)? {
        activeTask.map { ($0.taskID, $0.threadID, $0.turnID) }
    }
    private struct ActivePresence {
        let document: String
        let actor: AgentActor
        let publisher: PresencePublisher
    }
    private var activePresence: ActivePresence?
    private var presenceTask: Task<Void, Never>?

    init(root: URL,
         presencePublisher: @escaping () -> PresencePublisher = { PresencePublisher() },
         serverFactory: (() throws -> any LocalVaultAgentServer)? = nil,
         ownsProfile: Bool = false,
         cancellationTimeout: TimeInterval = 15) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
        self.makePresencePublisher = presencePublisher
        self.makeServer = serverFactory
        self.ownsProfile = ownsProfile
        self.cancellationTimeout = max(0.01, cancellationTimeout)
        files = DispatchQueue(label: "app.texttext.vault-agent-files", qos: .userInitiated)
    }
    deinit { deadline?.cancel(); presenceTask?.cancel(); server?.stop() }

    private static func makeDiagnosticID() -> String {
        "TT-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12).uppercased()
    }

    private func update(_ state: String, message: String? = nil,
                        failure: CodexConnectionFailure? = nil,
                        diagnosticID: String? = nil) {
        status = ["state": state]
        if let message { status["message"] = message }
        if let failure {
            status["failureCode"] = failure.code
            status["recoveryAction"] = failure.recoveryAction
            status["diagnosticId"] = diagnosticID ?? connectionDiagnosticID
        }
        if let accountEmail { status["accountEmail"] = accountEmail }
        var event = status; event["type"] = "status"; onEvent?(event)
    }
    private func request(_ method: String, _ params: [String: Any] = [:], task: ActiveTask? = nil) throws {
        guard let server else { throw CodexAppServerError.notRunning }
        let id = UUID().uuidString
        pending[id] = PendingRequest(method: method, taskID: task?.taskID,
            taskInstanceID: task?.instanceID)
        do { try server.send(id: id, method: method, params: params) }
        catch { pending.removeValue(forKey: id); throw error }
    }
    private func armDeadline(seconds: Double) {
        deadline?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.fail("The agent stopped responding. Your files are preserved. Reconnect to retry.")
        }
        deadline = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    func connect() throws {
        if server != nil {
            update(busy ? "working" : (disabledMCPServers == nil ? "connecting" : "ready"))
            return
        }
        stop()
        connectionDiagnosticID = Self.makeDiagnosticID()
        let runtime: any LocalVaultAgentServer
        if let makeServer {
            runtime = try makeServer()
        } else {
            #if TEXTTEXT_STORE
            let bundled = CodexEmbeddedRuntime.bundledExecutable(sandboxed: true)
            let executable = bundled
            #else
            let bundled = CodexEmbeddedRuntime.bundledExecutable(sandboxed: false)
            let executable = bundled ?? CodexRuntimeLocator(bundleURL: Bundle.main.bundleURL).executableURL
            #endif
            guard let executable else {
                fail("The agent runtime executable is missing from the installed app.")
                throw CodexAppServerError.runtimeMissing
            }
            ownsProfile = bundled != nil
            var environment = ["TEXTTEXT_WORKSPACE_ROOT": root.path]
            if ownsProfile { environment["CODEX_HOME"] = try CodexEmbeddedRuntime.profileDirectory().path }
            runtime = CodexAppServerController(executableURL: executable,
                environment: environment, directTextTextTools: true)
        }
        let token = generation
        runtime.onEvent = { [weak self] message in
            DispatchQueue.main.async {
                guard let self, self.generation == token else { return }
                self.receive(message)
            }
        }
        runtime.onExit = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.generation == token else { return }
                if self.disconnecting { self.finishDisconnect() }
                else { self.fail("The agent connection closed. Reconnect to continue.") }
            }
        }
        server = runtime
        do {
            try runtime.start()
            update("connecting")
            armDeadline(seconds: 30)
            try request("initialize", ["clientInfo": ["name": "texttext-vault", "title": "TextText", "version": "1"],
                                       "capabilities": ["experimentalApi": true]])
        } catch {
            let failure = CodexConnectionFailure(error.localizedDescription)
            fail(error.localizedDescription)
            throw VaultAgentError(failure.message)
        }
    }

    func send(taskID: String, prompt: String, path: String? = nil, customizing: Bool = false) throws {
        guard server != nil, let disabledMCPServers, !busy else {
            throw VaultAgentError("Connect the agent and wait for its current reply first.")
        }
        guard Self.validTaskID(taskID) else {
            throw VaultAgentError("This agent task has an invalid id.")
        }
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 32_000 else { throw VaultAgentError("Enter a message of up to 32,000 characters.") }
        if customizing && path == nil { throw VaultAgentError("Choose a document to customize first.") }
        let access = try resolveAccess(path: path, customizing: customizing)
        var context = customizing ? "Presentation customization mode: propose a template preview for the current document. Do not write or create files. If content.fields.texttextFolderView is v1, this is the containing folder's design: customize template.collection and preview its immediate members. Preserve the marker and all member files. Supported folder layouts are cards, list and index (a reference table); use supported collection bindings.\n" : ""
        if let path {
            context += "Current document path: \(path)\nRead the actual file before making changes.\n\n"
        }
        let task = ActiveTask(instanceID: UUID(), taskID: taskID,
            diagnosticID: Self.makeDiagnosticID(),
            prompt: context + trimmed, access: access,
            fileFence: LocalVaultAgentCancellation())
        activeTask = task
        busy = true; phases.removeAll(); update("working")
        beginPresence(for: access)
        armDeadline(seconds: 120)
        do {
            // Every submitted task gets a private ephemeral model thread. A
            // previous task's context and late notifications can never cross
            // this task boundary, even when its file scope is identical.
            try request("thread/start", CodexAppServerRequests.threadStart(
                dynamicTools: CodexAppServerRequests.textTextToolNamespace(LocalVaultAgentFiles.tools(for: access)),
                disabledMCPServers: disabledMCPServers, workingDirectory: root.path,
                developerInstructions: access.developerInstructions), task: task)
        } catch {
            let failure = classifiedFailure(error.localizedDescription, diagnosticID: task.diagnosticID)
            abandonTask(taskID: taskID, instanceID: task.instanceID)
            emitTaskEvent(["type": "error", "message": failure.message,
                "failureCode": failure.code, "recoveryAction": failure.recoveryAction,
                "diagnosticId": task.diagnosticID], taskID: taskID)
            throw VaultAgentError(failure.message)
        }
    }

    private static func validTaskID(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && !value.unicodeScalars.contains {
            $0.value < 0x20 || $0.value == 0x7f
        }
    }

    private func beginPresence(for access: LocalVaultAgentAccess) {
        endPresence()
        let path: String, activity: AgentActor.Activity
        switch access {
        case .item(let selected): path = selected; activity = .edit
        case .itemCustomization(let selected): path = selected; activity = .open
        default: return
        }
        guard let document = try? LocalVaultDocumentStore(root: root).readMetadata(path: path),
              let itemID = MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId,
              (try? LocalVaultSync.collaborationReady(
                root: root, path: path, itemId: itemID, localHash: document.hash)) == true else { return }
        let publisher = makePresencePublisher()
        guard publisher.isConfigured else { return }
        let presence = ActivePresence(document: path,
            actor: AgentActor(name: "Codex", activity: activity, itemId: itemID), publisher: publisher)
        activePresence = presence
        let previous = presenceTask
        presenceTask = Task {
            _ = await previous?.result
            guard !Task.isCancelled else { return }
            await presence.publisher.publish(document: presence.document, actor: presence.actor, active: true)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(8)) } catch { break }
                guard !Task.isCancelled else { break }
                await presence.publisher.publish(document: presence.document, actor: presence.actor, active: true)
            }
        }
    }

    private func endPresence() {
        guard let presence = activePresence else { return }
        activePresence = nil
        let previous = presenceTask
        previous?.cancel()
        presenceTask = Task {
            _ = await previous?.result
            await presence.publisher.publish(document: presence.document, actor: presence.actor, active: false)
        }
    }

    private func startTurn(task: ActiveTask, prompt: String, threadID: String) throws {
        try request("turn/start", ["threadId": threadID,
            "input": [["type": "text", "text": prompt]], "approvalPolicy": "never"], task: task)
    }

    private func resolveAccess(path: String?, customizing: Bool) throws -> LocalVaultAgentAccess {
        guard let path else { return .folder(path: "") }
        let store = LocalVaultDocumentStore(root: root)
        let file = try store.readMetadata(path: path)
        let folder = (path as NSString).deletingLastPathComponent
        let isFolderDesign: Bool
        if let raw = file.contents.documentJSON,
           let snapshot = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
           let content = snapshot["content"] as? [String: Any],
           let fields = content["fields"] as? [String: Any] {
            isFolderDesign = fields["texttextFolderView"] as? String == "v1"
        } else {
            isFolderDesign = false
        }
        if isFolderDesign {
            return customizing
                ? .folderCustomization(folder: folder, designPath: path)
                : .folder(path: folder)
        }
        return customizing ? .itemCustomization(path: path) : .item(path: path)
    }

    func cancel(taskID: String) throws {
        guard Self.validTaskID(taskID), var task = activeTask, task.taskID == taskID else {
            throw VaultAgentError("No matching agent task is running.")
        }
        guard !task.cancelRequested else { return }
        task.cancelRequested = true
        task.fileFence.cancel()
        activeTask = task
        endPresence()
        pendingProposals.removeAll()
        phases.removeAll()

        guard task.threadID != nil else {
            // App Server has no thread/start cancellation. Removing the task
            // prevents its eventual response from starting a model turn.
            finishCancelledTask(taskID: taskID, instanceID: task.instanceID)
            return
        }
        armCancellationDeadline(taskID: taskID, instanceID: task.instanceID)
        interruptTaskIfPossible(taskID: taskID, instanceID: task.instanceID)
    }

    /// Disconnects TextText's account session. A bundled runtime owns its
    /// private profile, so sign that profile out before stopping it. An
    /// external runtime may share credentials with other clients; only stop
    /// TextText's process in that case.
    func disconnect() throws {
        guard !busy else {
            throw VaultAgentError("Stop the current task before disconnecting Codex.")
        }
        guard server != nil else { finishDisconnect(); return }
        disconnecting = true
        update("connecting", message: "Disconnecting Codex…")
        guard ownsProfile, accountEmail != nil else { finishDisconnect(); return }
        deadline?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.finishDisconnect() }
        deadline = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
        do { try request("account/logout") }
        catch { finishDisconnect() }
    }

    private func finishDisconnect() {
        stop()
        accountEmail = nil
        update("disconnected")
    }

    func stop() {
        endPresence()
        activeTask?.fileFence.cancel()
        if let loginID { try? request("account/login/cancel", ["loginId": loginID]) }
        loginID = nil; attemptedLogin = false; disconnecting = false
        generation = UUID(); pendingProposals.removeAll(); deadline?.cancel(); deadline = nil
        server?.onEvent = nil; server?.onExit = nil; server?.stop(); server = nil
        activeTask = nil; disabledMCPServers = nil
        busy = false; pending.removeAll(); phases.removeAll()
    }

    private func classifiedFailure(_ raw: String, diagnosticID: String) -> CodexConnectionFailure {
        let failure = CodexConnectionFailure(raw)
        Self.log.error("agent failure category=\(failure.code, privacy: .public) diagnostic=\(diagnosticID, privacy: .public)")
        return failure
    }

    private func failureEvent(_ raw: String, diagnosticID: String) -> [String: Any] {
        let failure = classifiedFailure(raw, diagnosticID: diagnosticID)
        return ["type": "error", "message": failure.message,
                "failureCode": failure.code, "recoveryAction": failure.recoveryAction,
                "diagnosticId": diagnosticID]
    }

    private func fail(_ raw: String) {
        let task = activeTask
        let diagnosticID = task?.diagnosticID ?? connectionDiagnosticID
        let failure = classifiedFailure(raw, diagnosticID: diagnosticID)
        stop()
        update("failed", message: failure.message, failure: failure, diagnosticID: diagnosticID)
        if let task {
            emitTaskEvent(["type": "error", "message": failure.message,
                "failureCode": failure.code, "recoveryAction": failure.recoveryAction,
                "diagnosticId": diagnosticID], taskID: task.taskID)
        }
    }

    private func abandonTask(taskID: String, instanceID: UUID) {
        guard let task = activeTask, task.taskID == taskID,
              task.instanceID == instanceID else { return }
        task.fileFence.cancel()
        endPresence()
        activeTask = nil
        busy = false
        pendingProposals.removeAll()
        phases.removeAll()
        deadline?.cancel()
        deadline = nil
        update("ready")
    }

    private func finishTask(taskID: String, instanceID: UUID, event: [String: Any]) {
        guard activeTask?.taskID == taskID,
              activeTask?.instanceID == instanceID else { return }
        abandonTask(taskID: taskID, instanceID: instanceID)
        emitTaskEvent(event, taskID: taskID)
    }

    private func finishCancelledTask(taskID: String, instanceID: UUID) {
        finishTask(taskID: taskID, instanceID: instanceID, event: [
            "type": "turn-cancelled",
            "message": Self.cancellationMessage,
        ])
    }

    private func emitTaskEvent(_ event: [String: Any], taskID: String) {
        var correlated = event
        correlated["taskId"] = taskID
        onEvent?(correlated)
    }

    private func armCancellationDeadline(taskID: String, instanceID: UUID) {
        deadline?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let task = self.activeTask,
                  task.taskID == taskID, task.instanceID == instanceID,
                  task.cancelRequested else { return }
            self.finishCancelledTask(taskID: taskID, instanceID: instanceID)
        }
        deadline = work
        DispatchQueue.main.asyncAfter(deadline: .now() + cancellationTimeout, execute: work)
    }

    private func interruptTaskIfPossible(taskID: String, instanceID: UUID) {
        guard var task = activeTask, task.taskID == taskID, task.cancelRequested,
              task.instanceID == instanceID,
              !task.interruptSent, let threadID = task.threadID, let turnID = task.turnID else { return }
        task.interruptSent = true
        activeTask = task
        do {
            try request("turn/interrupt", CodexAppServerRequests.turnInterrupt(
                threadID: threadID, turnID: turnID), task: task)
        } catch {
            finishCancelledTask(taskID: taskID, instanceID: instanceID)
        }
    }

    private func receive(_ message: CodexAppServerMessage) {
        if let id = message.id, message.method == nil, let pendingRequest = pending.removeValue(forKey: id) {
            if let instanceID = pendingRequest.taskInstanceID,
               activeTask?.instanceID != instanceID { return }
            if let error = message.errorMessage {
                if pendingRequest.method == "account/logout" {
                    finishDisconnect()
                    return
                }
                if let taskID = pendingRequest.taskID {
                    guard let instanceID = pendingRequest.taskInstanceID else { return }
                    if activeTask?.cancelRequested == true {
                        finishCancelledTask(taskID: taskID, instanceID: instanceID)
                    } else {
                        let diagnosticID = activeTask?.diagnosticID ?? connectionDiagnosticID
                        finishTask(taskID: taskID, instanceID: instanceID,
                            event: failureEvent(error, diagnosticID: diagnosticID))
                    }
                } else {
                    fail(error)
                }
                return
            }
            do {
                switch pendingRequest.method {
                case "initialize":
                    try server?.notify(method: "initialized", params: [:])
                    try request("account/read")
                case "account/read":
                    guard let account = CodexAccountSummary(result: message.rawResult) else {
                        guard !attemptedLogin else { throw VaultAgentError("ChatGPT sign-in did not complete. Reconnect to try again.") }
                        attemptedLogin = true
                        try request("account/login/start", CodexAppServerRequests.chatGPTLoginStart)
                        return
                    }
                    accountEmail = account.email
                    try request("config/read", ["includeLayers": false])
                case "account/login/start":
                    guard let id = message.rawResult?["loginId"] as? String,
                          let raw = message.rawResult?["authUrl"] as? String,
                          let url = URL(string: raw), url.scheme == "https",
                          ["auth.openai.com", "chatgpt.com"].contains(url.host ?? ""),
                          url.user == nil, url.password == nil else {
                        throw VaultAgentError("The agent returned an invalid sign-in address.")
                    }
                    loginID = id
                    guard NSWorkspace.shared.open(url) else { throw VaultAgentError("Your browser could not open ChatGPT sign-in. Reconnect to try again.") }
                    update("connecting", message: "Complete ChatGPT sign-in in your browser. This window will connect automatically.")
                    armDeadline(seconds: 600)
                case "config/read":
                    guard let disabled = CodexAppServerRequests.effectiveMCPServerNames(configReadResult: message.rawResult) else {
                        throw VaultAgentError("The agent runtime did not return its tool configuration.")
                    }
                    disabledMCPServers = disabled
                    deadline?.cancel(); update("ready")
                case "account/logout":
                    finishDisconnect()
                case "thread/start":
                    guard let taskID = pendingRequest.taskID,
                          var task = activeTask, task.taskID == taskID else { return }
                    guard let thread = message.rawResult?["thread"] as? [String: Any], let id = thread["id"] as? String else {
                        throw VaultAgentError("The agent did not start a workspace chat.")
                    }
                    task.threadID = id
                    activeTask = task
                    try startTurn(task: task, prompt: task.prompt, threadID: id)
                case "turn/start":
                    guard let taskID = pendingRequest.taskID,
                          var task = activeTask, task.taskID == taskID else { return }
                    guard let turn = message.rawResult?["turn"] as? [String: Any],
                          let turnID = turn["id"] as? String, !turnID.isEmpty else {
                        throw VaultAgentError("The agent did not identify the task it started.")
                    }
                    if let known = task.turnID, known != turnID {
                        throw VaultAgentError("The agent returned a mismatched task id.")
                    }
                    task.turnID = turnID
                    activeTask = task
                    interruptTaskIfPossible(taskID: taskID, instanceID: task.instanceID)
                case "turn/interrupt":
                    break
                default: break
                }
            } catch {
                if let taskID = pendingRequest.taskID {
                    guard let instanceID = pendingRequest.taskInstanceID else { return }
                    if activeTask?.cancelRequested == true {
                        finishCancelledTask(taskID: taskID, instanceID: instanceID)
                    } else {
                        let diagnosticID = activeTask?.diagnosticID ?? connectionDiagnosticID
                        finishTask(taskID: taskID, instanceID: instanceID,
                            event: failureEvent(error.localizedDescription, diagnosticID: diagnosticID))
                    }
                } else {
                    fail(error.localizedDescription)
                }
            }
            return
        }
        if message.method == "account/login/completed" {
            guard let loginID, message.rawParams?["loginId"] as? String == loginID else { return }
            self.loginID = nil
            guard message.rawParams?["success"] as? Bool == true else {
                fail("ChatGPT sign-in was cancelled or failed. Reconnect to try again."); return
            }
            armDeadline(seconds: 30)
            do { try request("account/read") } catch { fail(error.localizedDescription) }
            return
        }

        guard var task = taskForMessage(message) else {
            rejectToolCall(message, reason: "This tool call belongs to an inactive agent task.")
            return
        }
        if message.method == "turn/started" {
            guard let turnID = Self.turnID(in: message), !turnID.isEmpty else { return }
            if let known = task.turnID, known != turnID { return }
            task.turnID = turnID
            activeTask = task
            interruptTaskIfPossible(taskID: task.taskID, instanceID: task.instanceID)
            return
        }
        if task.cancelRequested {
            rejectToolCall(message, reason: "This agent task was stopped before the tool could run.")
            if message.method == "turn/completed" {
                finishCancelledTask(taskID: task.taskID, instanceID: task.instanceID)
            }
            return
        }
        if ["item/started", "item/agentMessage/delta", "item/completed", "item/tool/call"].contains(message.method ?? "") {
            armDeadline(seconds: 120)
        }
        if message.method == "item/started", let item = CodexAgentMessage(params: message.rawParams) {
            phases[item.id] = item.phase
        } else if message.method == "item/agentMessage/delta",
                  let id = message.rawParams?["itemId"] as? String, phases[id] == .finalAnswer,
                  let text = message.rawParams?["delta"] as? String {
            emitTaskEvent(["type": "text-delta", "text": String(text.prefix(32_000))], taskID: task.taskID)
        } else if message.method == "item/completed", let item = CodexAgentMessage(params: message.rawParams), item.phase == .finalAnswer {
            emitTaskEvent(["type": "final-text", "text": String(item.text.prefix(64_000))], taskID: task.taskID)
        } else if message.method == "item/tool/call", let requestID = message.jsonRPCID {
            performTool(message, requestID: requestID, task: task)
        } else if message.method == "turn/completed" {
            switch CodexTurnOutcome(params: message.rawParams) {
            case .completed:
                finishTask(taskID: task.taskID, instanceID: task.instanceID,
                    event: ["type": "turn-completed"])
            case .failed(let detail):
                let diagnosticID = task.diagnosticID
                finishTask(taskID: task.taskID, instanceID: task.instanceID,
                    event: failureEvent(detail ?? "The agent stopped before finishing. Saved file changes are preserved.",
                        diagnosticID: diagnosticID))
            case .interrupted:
                finishCancelledTask(taskID: task.taskID, instanceID: task.instanceID)
            case nil:
                finishTask(taskID: task.taskID, instanceID: task.instanceID,
                    event: failureEvent("The agent stopped before finishing. Saved file changes are preserved.",
                        diagnosticID: task.diagnosticID))
            }
        }
    }

    private static func turnID(in message: CodexAppServerMessage) -> String? {
        if let direct = message.rawParams?["turnId"] as? String { return direct }
        return (message.rawParams?["turn"] as? [String: Any])?["id"] as? String
    }

    private func taskForMessage(_ message: CodexAppServerMessage) -> ActiveTask? {
        guard busy, let task = activeTask, let threadID = task.threadID,
              message.rawParams?["threadId"] as? String == threadID else { return nil }
        if let expected = task.turnID, let incoming = Self.turnID(in: message), incoming != expected {
            return nil
        }
        return task
    }

    private func rejectToolCall(_ message: CodexAppServerMessage, reason: String) {
        guard message.method == "item/tool/call", let requestID = message.jsonRPCID else { return }
        try? server?.respond(id: requestID,
            result: CodexAppServerRequests.dynamicToolResult(text: reason, success: false))
    }

    func proposalResult(taskID: String, proposalID: String, valid: Bool, message: String? = nil) throws {
        guard Self.validTaskID(taskID), busy, let task = activeTask,
              task.taskID == taskID, !task.cancelRequested,
              let pending = pendingProposals.removeValue(forKey: proposalID),
              pending.taskID == taskID else {
            throw VaultAgentError("This template preview is no longer pending validation.")
        }
        let feedback = String((message ?? "The template did not pass validation. Correct the declarative template and propose it again.").prefix(4_000))
        try server?.respond(id: pending.requestID, result: CodexAppServerRequests.dynamicToolResult(
            text: valid ? pending.value : "Template preview rejected: \(feedback)", success: valid))
        armDeadline(seconds: 120)
    }

    private func performTool(_ message: CodexAppServerMessage, requestID: AnyHashable, task: ActiveTask) {
        let params = message.rawParams ?? [:]
        guard params["namespace"] as? String == "texttext" else {
            try? server?.respond(id: requestID, result: CodexAppServerRequests.dynamicToolResult(text: "Unknown workspace tool.", success: false))
            return
        }
        let tool = (params["tool"] ?? params["name"]) as? String ?? ""
        let arguments = params["arguments"] as? [String: Any] ?? [:]
        let token = generation, root = root, fence = task.fileFence
        let taskID = task.taskID, taskInstanceID = task.instanceID, access = task.access
        let toolRequestID = ToolRequestID(rawValue: requestID)
        emitTaskEvent(["type": "tool-call", "tool": tool, "path": arguments["path"] ?? ""], taskID: taskID)
        files.async { [weak self] in
            let result = Result { try LocalVaultAgentFiles.perform(tool, arguments: arguments, root: root, access: access, cancellation: fence) }
            DispatchQueue.main.async {
                guard let self, self.generation == token else { return }
                guard let current = self.activeTask, current.taskID == taskID,
                      current.instanceID == taskInstanceID,
                      !current.cancelRequested, self.busy else {
                    try? self.server?.respond(id: toolRequestID.rawValue,
                        result: CodexAppServerRequests.dynamicToolResult(
                            text: "This tool result belongs to an inactive agent task.", success: false))
                    return
                }
                let text: String, success: Bool
                switch result {
                case .success(let value):
                    text = value; success = true
                    if tool == "write_file" || tool == "create_file" { self.onFilesChanged?() }
                    if tool == "propose_template", let data = value.data(using: .utf8),
                       var proposal = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                        guard self.pendingProposals.count < 4 else {
                            try? self.server?.respond(id: toolRequestID.rawValue, result: CodexAppServerRequests.dynamicToolResult(
                                text: "Wait for the pending template previews to finish validation before proposing another.", success: false))
                            return
                        }
                        let proposalID = UUID().uuidString
                        self.pendingProposals[proposalID] = PendingProposal(
                            requestID: toolRequestID.rawValue, value: value, taskID: taskID)
                        proposal["type"] = "template-proposal"
                        proposal["proposalId"] = proposalID
                        self.armDeadline(seconds: 120)
                        self.emitTaskEvent(proposal, taskID: taskID)
                        return
                    }
                case .failure(let error): text = error.localizedDescription; success = false
                }
                try? self.server?.respond(id: toolRequestID.rawValue,
                    result: CodexAppServerRequests.dynamicToolResult(text: text, success: success))
            }
        }
    }
}

struct VaultAgentError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

final class LocalVaultAgentCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    func check() throws {
        lock.lock(); let stopped = cancelled; lock.unlock()
        if stopped { throw VaultAgentError("The agent was stopped before this file operation began.") }
    }
}

enum LocalVaultAgentAccess: Equatable, Sendable {
    case item(path: String)
    case folder(path: String)
    case itemCustomization(path: String)
    case folderCustomization(folder: String, designPath: String)

    fileprivate var allowedToolNames: Set<String> {
        switch self {
        case .item:
            return ["read_file", "write_file"]
        case .folder:
            return ["list_files", "read_file", "write_file", "create_file", "search_files"]
        case .itemCustomization:
            return ["read_file", "propose_template"]
        case .folderCustomization:
            return ["list_files", "read_file", "search_files", "propose_template"]
        }
    }

    var developerInstructions: String {
        let boundary: String
        switch self {
        case .item(let path):
            boundary = "You may read and edit only the exact current item at \(path). No other file or folder is in scope."
        case .folder(let path):
            boundary = path.isEmpty
                ? "The selected folder is the workspace root. You may work only inside that folder."
                : "The selected folder is \(path). You may work only inside that exact folder boundary."
        case .itemCustomization(let path):
            boundary = "Customization is read-only. Read only \(path) and use propose_template only for that exact item. Direct file writes and creation are unavailable."
        case .folderCustomization(let folder, let designPath):
            let name = folder.isEmpty ? "the workspace root" : folder
            boundary = "Customization is read-only. You may inspect TextPacks only inside \(name) and use propose_template only for its design TextPack at \(designPath). Direct file writes and creation are unavailable."
        }
        return """
        You are TextText's assistant for a selected local TextPack scope.
        Use only the supplied texttext file tools for workspace work. They operate directly on local files without any hosted workspace API. Do not use installed skills, other MCP servers, or other integrations.
        \(boundary)
        Read a file before editing it. Pass its exact hash to write_file. On a stale-file error, read again, preserve the user's intervening edits, and retry at most once. Never replace a file blindly. Do not edit anything for a read-only request.
        TextPack contains Markdown, a schema-v1 document snapshot, an embedded template, and assets. Preserve metadata and assets. For a template change, read its templateJSON first and update validated declarative JSON, never executable HTML, CSS, or JavaScript. Keep Markdown and documentJSON content consistent when supplying both.
        A proposed template is only a preview. The user decides whether to keep it in the app. Keep responses concise, distinguish previews from saved changes, and report which files changed. A failed save means the file was not changed.
        """
    }

    fileprivate func validated(root: URL) throws -> Self {
        switch self {
        case .item(let path):
            return .item(path: try Self.canonicalFile(path, root: root))
        case .folder(let path):
            return .folder(path: try Self.canonicalFolder(path, root: root))
        case .itemCustomization(let path):
            return .itemCustomization(path: try Self.canonicalFile(path, root: root))
        case .folderCustomization(let folder, let designPath):
            let folder = try Self.canonicalFolder(folder, root: root)
            let designPath = try Self.canonicalFile(designPath, root: root)
            guard Self.contains(designPath, folder: folder) else {
                throw VaultAgentError("The folder design TextPack is outside the selected folder.")
            }
            return .folderCustomization(folder: folder, designPath: designPath)
        }
    }

    fileprivate func authorize(tool name: String) throws {
        guard allowedToolNames.contains(name) else {
            if case .itemCustomization = self {
                throw VaultAgentError("Customization stages a preview. Only the user can keep it; file writes are disabled for this task.")
            }
            if case .folderCustomization = self {
                throw VaultAgentError("Customization stages a preview. Only the user can keep it; file writes are disabled for this task.")
            }
            throw VaultAgentError("That file operation is outside this task's access scope.")
        }
    }

    fileprivate func authorizeFile(_ path: String, operation: String, root: URL) throws -> String {
        let path = try Self.canonicalFile(path, root: root)
        let allowed: Bool
        switch self {
        case .item(let selected), .itemCustomization(let selected):
            allowed = path == selected
        case .folder(let folder), .folderCustomization(let folder, _):
            allowed = Self.contains(path, folder: folder)
        }
        guard allowed else { throw VaultAgentError("Cannot \(operation) a file outside this task's access scope.") }
        return path
    }

    fileprivate func authorizeProposal(_ path: String, root: URL) throws -> String {
        let path = try Self.canonicalFile(path, root: root)
        switch self {
        case .itemCustomization(let selected):
            guard path == selected else { throw VaultAgentError("Propose a template only for the selected document.") }
        case .folderCustomization(_, let designPath):
            guard path == designPath else { throw VaultAgentError("Propose a template only for the selected folder's design TextPack.") }
        default:
            throw VaultAgentError("Template proposals are available only during customization.")
        }
        return path
    }

    fileprivate func authorizeCreation(in requestedFolder: String, root: URL) throws -> String {
        let requestedFolder = try Self.canonicalFolder(requestedFolder, root: root)
        guard case .folder(let folder) = self,
              requestedFolder == folder || (!folder.isEmpty && requestedFolder.hasPrefix(folder + "/")) || folder.isEmpty else {
            throw VaultAgentError("Cannot create a file outside this task's folder scope.")
        }
        return requestedFolder
    }

    fileprivate func scopedFolder(root: URL) throws -> (root: URL, prefix: String) {
        let folder: String
        switch self {
        case .folder(let path), .folderCustomization(let path, _): folder = path
        default: throw VaultAgentError("This task does not have folder-wide access.")
        }
        let canonical = try Self.canonicalFolder(folder, root: root)
        let base = canonical.isEmpty ? root : root.appendingPathComponent(canonical, isDirectory: true)
        return (base.standardizedFileURL.resolvingSymlinksInPath(), canonical)
    }

    private static func canonicalFile(_ path: String, root: URL) throws -> String {
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let target = try LocalVaultDocumentStore(root: canonicalRoot).url(for: path)
        let relative = String(target.path.dropFirst(canonicalRoot.path.count).drop { $0 == "/" })
        guard !relative.isEmpty else { throw LocalVaultDocumentStore.Failure.invalidPath }
        return relative
    }

    private static func canonicalFolder(_ path: String, root: URL) throws -> String {
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let sentinelPath = (path.isEmpty ? "" : path + "/") + "TextText scope.textpack"
        let sentinel = try LocalVaultDocumentStore(root: canonicalRoot).url(for: sentinelPath)
        let directory = sentinel.deletingLastPathComponent().standardizedFileURL.resolvingSymlinksInPath()
        guard directory.path == canonicalRoot.path || directory.path.hasPrefix(canonicalRoot.path + "/") else {
            throw LocalVaultDocumentStore.Failure.invalidPath
        }
        return String(directory.path.dropFirst(canonicalRoot.path.count).drop { $0 == "/" })
    }

    private static func contains(_ path: String, folder: String) -> Bool {
        folder.isEmpty || path.hasPrefix(folder + "/")
    }
}

enum LocalVaultAgentFiles {
    private static let allTools: [[String: Any]] = [
        tool("list_files", "List TextPack paths in the selected folder.", [:], []),
        tool("read_file", "Read a TextPack, including Markdown, snapshot, template and the hash needed for a safe edit.", ["path": "string"], ["path"]),
        tool("propose_template", "Stage a template preview for the user to refine or keep. Reads the actual file and requires its current hash. Does not write any file. Supply complete declarative template JSON.",
             ["path": "string", "hash": "string", "templateJSON": "string", "templateAuthoringSourceJSON": "string"], ["path", "hash", "templateJSON"]),
        tool("write_file", "Save Markdown and optional snapshot/template JSON to the real file. Requires the hash from read_file; preserves assets and omitted metadata.",
             ["path": "string", "hash": "string", "markdown": "string", "documentJSON": "string", "templateJSON": "string", "templateAuthoringSourceJSON": "string"], ["path", "hash", "markdown"]),
        tool("create_file", "Create a new self-contained TextPack in an existing relative folder.", ["title": "string", "body": "string", "folder": "string", "kind": "string"], ["title", "body"]),
        tool("search_files", "Search titles and content in the local folder without a server.", ["query": "string"], ["query"]),
    ]
    static func tools(for access: LocalVaultAgentAccess) -> [[String: Any]] {
        allTools.filter { tool in
            guard let name = tool["name"] as? String else { return false }
            return access.allowedToolNames.contains(name)
        }
    }
    private static func tool(_ name: String, _ description: String, _ properties: [String: String], _ required: [String]) -> [String: Any] {
        ["type": "function", "name": name, "description": description,
         "inputSchema": ["type": "object", "properties": properties.mapValues { ["type": $0] },
                         "required": required, "additionalProperties": false]]
    }
    static func perform(_ name: String, arguments: [String: Any], root: URL,
                        access suppliedAccess: LocalVaultAgentAccess,
                        cancellation: LocalVaultAgentCancellation? = nil) throws -> String {
        let access = try suppliedAccess.validated(root: root)
        try access.authorize(tool: name)
        try cancellation?.check()
        func string(_ key: String) throws -> String {
            guard let value = arguments[key] as? String, value.utf8.count <= 2_000_000 else {
                throw VaultAgentError("Missing or oversized \(key).")
            }
            return value
        }
        let store = LocalVaultDocumentStore(root: root), documents = DocumentStore(root: root)
        let output: Any
        switch name {
        case "list_files":
            let scope = try access.scopedFolder(root: root)
            let paths = try LocalVaultDocumentStore(root: scope.root).list().prefix(1_000).map {
                scope.prefix.isEmpty ? $0 : scope.prefix + "/" + $0
            }
            output = ["paths": paths]
        case "read_file":
            let path = try access.authorizeFile(string("path"), operation: "read", root: root)
            let file = try store.read(path: path)
            output = ["path": file.path, "hash": file.hash, "markdown": file.contents.markdown,
                      "documentJSON": file.contents.documentJSON ?? "", "templateJSON": file.contents.templateJSON ?? "",
                      "templateAuthoringSourceJSON": file.contents.templateAuthoringSourceJSON ?? ""]
        case "propose_template":
            let path = try access.authorizeProposal(string("path"), root: root)
            let expected = try string("hash"), template = try string("templateJSON")
            let current = try store.read(path: path)
            guard current.hash == expected else { throw VaultAgentError("This file changed since it was read. Read it again before proposing a template.") }
            guard let rawSnapshot = current.contents.documentJSON,
                  var snapshot = try JSONSerialization.jsonObject(with: Data(rawSnapshot.utf8)) as? [String: Any],
                  let definition = try JSONSerialization.jsonObject(with: Data(template.utf8)) as? [String: Any],
                  var presentation = snapshot["presentation"] as? [String: Any],
                  let id = definition["id"] as? String, let version = definition["version"] as? Int else {
                throw VaultAgentError("The proposal must contain a schema-v1 template JSON object.")
            }
            presentation["template"] = ["id": id, "version": version]
            snapshot["presentation"] = presentation
            try validate(snapshot: String(decoding: JSONSerialization.data(withJSONObject: snapshot), as: UTF8.self), template: template)
            var proposal: [String: Any] = ["path": current.path, "hash": current.hash, "templateJSON": template]
            if arguments["templateAuthoringSourceJSON"] != nil {
                let source = try string("templateAuthoringSourceJSON")
                guard (try JSONSerialization.jsonObject(with: Data(source.utf8))) is [String: Any] else {
                    throw VaultAgentError("Template authoring source must be a JSON object.")
                }
                proposal["templateAuthoringSourceJSON"] = source
            }
            try cancellation?.check()
            output = proposal
        case "write_file":
            let path = try access.authorizeFile(string("path"), operation: "write", root: root)
            let expected = try string("hash"), markdown = try string("markdown")
            let current = try store.read(path: path)
            if arguments["documentJSON"] == nil && arguments["templateJSON"] == nil && arguments["templateAuthoringSourceJSON"] == nil {
                try cancellation?.check()
                try documents.writeMarkdown(markdown, to: store.url(for: path), ifMatchHash: expected)
            } else {
                let identity = MarkdownIdentityCodec.extract(from: current.contents.markdown)
                let preserved = identity.map { MarkdownIdentityCodec.inject(into: markdown, itemId: $0.itemId, folderId: $0.folderId, kind: $0.kind) } ?? markdown
                let snapshot = arguments["documentJSON"] as? String ?? current.contents.documentJSON
                let template = arguments["templateJSON"] as? String ?? current.contents.templateJSON
                try validate(snapshot: snapshot, template: template)
                try cancellation?.check()
                _ = try store.write(path: path, expectedHash: expected, markdown: preserved,
                    documentJSON: snapshot,
                    templateJSON: template,
                    templateAuthoringSourceJSON: arguments["templateAuthoringSourceJSON"] as? String ?? current.contents.templateAuthoringSourceJSON)
            }
            let saved = try store.read(path: path)
            output = ["path": path, "hash": saved.hash]
        case "create_file":
            try cancellation?.check()
            let requestedFolder: String
            if let value = arguments["folder"] {
                guard let value = value as? String else { throw VaultAgentError("Missing or oversized folder.") }
                requestedFolder = value
            } else {
                requestedFolder = ""
            }
            let folder = try access.authorizeCreation(in: requestedFolder, root: root)
            let file = try documents.create(title: string("title"), body: string("body"),
                folder: folder.isEmpty ? nil : folder, kind: arguments["kind"] as? String ?? "note")
            output = ["path": documents.relativePath(of: file)]
        case "search_files":
            let scope = try access.scopedFolder(root: root)
            output = try DocumentStore(root: scope.root).searchPage(string("query"), textpacksOnly: true).items.map {
                ["path": scope.prefix.isEmpty ? $0.id : scope.prefix + "/" + $0.id,
                 "title": $0.title, "snippet": $0.snippet, "hash": $0.hash]
            }
        default: throw VaultAgentError("Unknown file tool.")
        }
        let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys, .withoutEscapingSlashes])
        guard data.count <= 2_000_000 else { throw VaultAgentError("This result is too large for the assistant. Use a smaller file or a narrower search.") }
        return String(decoding: data, as: UTF8.self)
    }
    private static func validate(snapshot: String?, template: String?) throws {
        guard let snapshot, let template, snapshot.utf8.count <= 2_000_000, template.utf8.count <= 2_000_000,
              let document = try JSONSerialization.jsonObject(with: Data(snapshot.utf8)) as? [String: Any],
              document["schemaVersion"] as? Int == 1,
              let content = document["content"] as? [String: Any],
              content["title"] is String, content["body"] is String,
              content["fields"] is [String: Any], content["tags"] is [String], content["assets"] is [[String: Any]],
              let presentation = document["presentation"] as? [String: Any],
              let reference = presentation["template"] as? [String: Any],
              let definition = try JSONSerialization.jsonObject(with: Data(template.utf8)) as? [String: Any],
              definition["schemaVersion"] as? Int == 1, definition["engineVersion"] as? Int == 1,
              let id = definition["id"] as? String, !id.isEmpty,
              let version = definition["version"] as? Int, version > 0,
              reference["id"] as? String == id, reference["version"] as? Int == version,
              definition["item"] is [String: Any], definition["collection"] is [String: Any],
              definition["fields"] is [[String: Any]] else {
            throw VaultAgentError("The snapshot and template must be matching schema-v1 JSON objects.")
        }
    }

}
