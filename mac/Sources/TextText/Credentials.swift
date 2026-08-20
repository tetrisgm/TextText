import Foundation

/// The linked device credential, stored as mode-0600 JSON inside the app's
/// mode-0700 state directory. The standalone edition also refreshes a private
/// Application Support handoff for its bundled CLI, which cannot read the app
/// group container. `token` is the raw wsk_ bearer minted by the approved
/// device link; `serverOrigin` pins it to the server that minted it.
struct Credentials: Codable {
    let token: String
    let serverOrigin: String
    let tokenName: String
    let linkedAt: Date
}
