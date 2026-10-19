# Actual WebView2 policy lanes

The isolated Windows policy smoke passed against committed base `fd0e4ccf7acd636934fda525a6fd407e4290532b` plus the two smoke test files. A private Program overlay selects the existing policy suite only; this is not a full desktop-suite or installed-app acceptance result.

Actual WebView2 executed the verified `texttext-mirror-policy-LCRyn0` bundle:

- 120 additional serialized vectors in each of visible, hidden and production `MainWindow.CreateMirrorPolicy` phases: binary queue 4, protected path 27, tombstone 20, saved rename 31, queued-upload path 38.
- 58 forged/reload refusals, including scope, request, observation, digest, page, generation, version and invalid action; the four newer strict schemas also reject unknown envelope/observation fields.
- Existing ordinary/schedule/queue/lifecycle checks, production readiness wait and native mirror/scheduler regressions passed.

Final evidence: `/private/tmp/texttext-webview-policy-20261019-24w4nm6b/`. `result.json` records the compiled smoke/app/Core hashes. All 3,223 source inputs match before/after; input manifest SHA `82359820fb71d92ab8fe7863a3696a7c9f522700385f780ece9b84522bad1de5`. Bundle script SHA `e4a6cc3150c66023184a7ed57d087ad966bcdb1825a9846c54d82e62cf1e32a5`; manifest SHA `6c45b9c5ef0e8a48bdc511ec13e2070f6899b926a3ed64eacd3a15aae22477d6`.

The existing WebView2 mitigation was verified without changing registry or SSH configuration. Before/after matching Security 4625/4740 counts were zero. Owner PID 42616 retained its executable and start time. The one-off interactive task was removed after exit; no owned dotnet/WebView2 processes remained. The smoke runner reported a retained temporary directory after best-effort cleanup; it was not deleted forcibly.

Two earlier refusals remain preserved: `...-yi6h7s00` incorrectly applied document expectations to binary-lane observations; `...-74ej_7ns` passed vectors/refusals but lacked generated app assets required by the production factory. The final fresh archive uses the existing explicit binary vectors unchanged and packages the exact verified bundle into generated Assets before compilation. No production policy, native adapter or owner state changed.
