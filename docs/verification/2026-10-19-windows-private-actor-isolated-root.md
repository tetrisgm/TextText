# Windows private actor isolated workspace

Source-only extension of the existing private acceptance runner. The [installed a0413982 product](2026-10-19-windows-a0413982-installed.md) is unchanged. No actor launch, real-account bootstrap, or six-client acceptance ran in this verification.

## Contract

Optional actor config `isolation: {version: 1, root, sessionRoot}` requires an immutable protected runner parent, a direct relay child with a bounded ordinary name, and exactly `generation-NNN` beneath that child, with root exactly `sessionRoot/vault`. The vault and scope survive distinct fresh relay sessions; one-level, three-level, cross-parent, and malformed generation/relay names refuse. Fresh root must be empty; all ancestors are checked with `GetAttributes`, including dangling reparse points. Unknown fields, invalid types, future versions, out-of-scope paths, and nonempty roots refuse.

Private startup resolves the existing native credential's account identity in memory and authorizes the requested workspace using production `WorkspaceDirectory` before creating the root. It reauthorizes and rereads the captured credential before native bridge publication. The normal production portable binding, account ownership publisher, HTTP transport, sync engine, renderer, and collaboration path remain in use. A separate create-only scope receipt records exact root/workspace/item/title/path and a principal hash; it is not an owner marker and contains no token. Readiness waits for actual native download before checking the real item identity and activating it.

Reopen requires unchanged scope, actual retained native owner and sync state, valid profile/principal, and the materialized fixture. Missing owner is never reconstructed. Interrupted preparation refuses rather than adopting work. The isolated runner rejects workspace/folder changes and sign-out before their UI or persistent effects. Existing normal/global credentials, Locations, workspace selection, and the legacy root remain untouched. Existing runner-private WebView profiles remain confined to the generation directory.

`TEXTTEXT_STRESS_ACTOR` is supplied only through the private LiveAcceptance project reference. It is removed from Core references to avoid building the same Core output under duplicate property identities. Normal builds exclude the helper, constructor, startup branch, and ingress guards. Legacy private actors without isolation retain their existing path.

## Focused evidence

Actual PC tests used a private committed archive plus ten exact named source overlays, never the installed app or a candidate patch. Archive base `d63e9a082852af84200fbaa149389974469aa11a` has identical committed Windows source to a0413982. Final named hashes matched before and after the gate.

- **33 assertions, no skips**: strict schema/path/root checks; actual production WindowsBridge worker download and durable state with controlled transport; genuine owner publication; fresh/reopen validation; late root membership refusal; future profile, foreign principal/workspace and missing owner refusal; exact state/profile/scope/projection retention; actual dangling reparse refusal.
- **4 Node source-contract tests** passed, including authorization ordering, normal exclusion and pre-effect workspace/folder/sign-out guards.
- Actual PC private-symbol WPF compilation, LiveAcceptance source compilation, and normal WPF compilation all passed. This is compilation evidence, not a sealed actor build or launch.
- PE metadata independently confirms normal DLL: no `PrivateActorWorkspace`, one MainWindow constructor; private DLL: helper present, two constructors. Diagnostic normal/private DLL SHA-256: `178e2e6b459aab38653b4fac4ca42e0d8368f081f2b9d6659702019e92d6eeb8` / `2161a581db93e17e3cedf21411026b65c2c6effc59f397ea7fdd431f42e4b484`.

Earlier harness compilation refusals, immediate readiness polling timeouts, and duplicate-Core CS2012 are retained. A diagnostic direct sync was not counted as automatic bootstrap proof. The final fixture waits for the actual native sync-status event before querying readiness, preserving the worker's initial nonblocking gate behavior; no timeout increase or production guard relaxation was used.

Private evidence: `/private/tmp/texttext-private-actor-isolation-6dd27920` and the same basename in PC LocalAppData/Temp. Final logs are `final-reviewed-{focused,private-wpf,actor-compile,normal-wpf}.log`; `final-reviewed-inputs.json` pins the ten source files. `final-metadata-exclusion.json` records PE inspection. Focused log SHA-256: `ed5e7d04e4beedca0139046901bc1554ea45c539234f23838ada6aaf6bb1642a`.

Postflight at 10:37:33Z: installed PID33756 remained responding with the exact a041 executable; normal legacy owner marker remains absent; no owned child processes; existing WebView2 mitigation unchanged; zero matching Shokunin 4625/4740 events since 10:23:19Z. Unchanged backup helper then reverified all **1,110 files / 7,340,498 bytes** of normal vault/state against the preinstall backup, inventory `16faaf065abc0843f8196e9be33f3181eccca7960a7dba6062a7b00d6cf1f062`, including the original single unbound conflicted outbox entry.

## Fresh-relay hierarchy followup

A genuine standard actor build/seal from `9af324ce` is retained separately with no runtime launch. Preparing its exact relay invocation exposed that the original direct-generation constraint tied the vault to a relay session which the existing relay refuses to reuse. That intermediate seal is not used or relabeled as corrected bootstrap/reopen evidence.

The helper now requires the exact two-level generation ancestry above. Actual PC **38 assertions, no skips**, include strict reopen through two distinct fresh relay children using the same real native owner/state/scope, plus all prior controlled initial-sync and retention checks. Actual PC actor source compilation passed; the Mac's **4 source-contract tests** passed. The two source hashes matched before/after the gate. Evidence: `hierarchy-{focused,actor-compile}.log` and `hierarchy-inputs.json` in the same private evidence root. No production normal path, relay existence guard, timeout, or account/adoption behavior changed.

## Next boundary

After reviewed commit, a fresh standard private-actor build/seal must attest its new source separately from normal product a041. A standalone existing-protocol hello/observe/close-probe/shutdown bootstrap can then verify real authenticated initial sync and asset bytes without claiming all-six acceptance. Future campaign generations must reopen this same genuine private owner/state, allowing the file role to verify the real mirror. The normal saved-work ownership review remains a separate human decision.
