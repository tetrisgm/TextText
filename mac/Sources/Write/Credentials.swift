import Foundation

/// The linked device credential, stored partyparty-style as plaintext JSON at
/// mode 0600 inside the 0700 state dir (~/Library/Application Support/Write).
/// `token` is the raw wsk_ bearer minted once by the approved device link;
/// `serverOrigin` pins the token to the server that minted it.
struct Credentials: Codable {
    let token: String
    let serverOrigin: String
    let tokenName: String
    let linkedAt: Date
}
