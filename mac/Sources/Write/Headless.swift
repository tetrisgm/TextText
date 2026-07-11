import Foundation
import WriteWorkspaceCore

/// WRITE_HEADLESS=1: no UI, one real sync pass through the exact engine the
/// app runs, a one-line JSON summary on stdout, exit 0/1. This is the CI
/// verify hook and the seed of a future CLI.
///
///   WRITE_HEADLESS=1 WRITE_TOKEN=wsk_... WRITE_SERVER=http://localhost:3000 \
///   WRITE_SYNC_ROOT=/tmp/write-sync swift run --package-path mac
///
/// WRITE_STATE_DIR is honored too (StateStore), so CI can isolate the index.
enum Headless {
    static func run() -> Int32 {
        let env = ProcessInfo.processInfo.environment
        guard let token = env["WRITE_TOKEN"], !token.isEmpty,
              let server = env["WRITE_SERVER"], let origin = URL(string: server), origin.host != nil,
              let rootPath = env["WRITE_SYNC_ROOT"], !rootPath.isEmpty else {
            FileHandle.standardError.write(Data(
                "WRITE_HEADLESS=1 requires WRITE_TOKEN, WRITE_SERVER, and WRITE_SYNC_ROOT\n".utf8))
            return 1
        }

        let store = StateStore()
        let engine = SyncEngine(store: store)
        engine.makeClient = { ServerClient(origin: origin, token: token) }
        engine.syncRootProvider = {
            URL(fileURLWithPath: (rootPath as NSString).expandingTildeInPath, isDirectory: true)
        }
        engine.workspaceLocationProvider = {
            WorkspaceRootResolver(overrideRoot: URL(
                fileURLWithPath: (rootPath as NSString).expandingTildeInPath,
                isDirectory: true
            )).resolve()
        }
        engine.callbackQueue = nil // no runloop here; deliver inline
        engine.onActivity = { message in
            FileHandle.standardError.write(Data("\(message)\n".utf8))
        }

        let summary = engine.runOnePassBlocking()
        print("{\"pulled\":\(summary.pulled),\"pushed\":\(summary.pushed),\"conflicts\":\(summary.conflicts),\"errors\":\(summary.errors)}")
        return summary.errors == 0 ? 0 : 1
    }
}
