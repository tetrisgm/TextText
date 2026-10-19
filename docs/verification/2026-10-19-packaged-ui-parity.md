# Packaged Mac and Windows shared UI

Read-only comparison of actual installed Windows75f assets and the passing normal Mac1273/4f candidate. Root independently hashed the actual Mac app Resources/LocalVault files; PC installed files matched their original candidate.

| Asset | Result |
| --- | --- |
| app.css | Byte-identical, SHA256 e697216e7a253da5fc2f3a3b0ac59eb289bbd16e37f31e99db273ca8b1d476ff |
| index.html | Byte-identical, SHA256 7e56ee8252b8d47ab1375264187ad51bc35fc4c83641e052608e673d9d15e0e9 |
| app.js | Platform entry differs: Windows installs its WebView transport before rendering the same VaultApp |

The shared UI/component/build source subtrees have no delta between75f5b4cb and4fdddd4a. Windows JS d54cd24fbfb5e53909eb36b06502cb87098803d17f82577f172aca4733dd7c26; Mac JS1c72233cede631c625cd6755c641526e70498bfdb35858873c44796d19ca7205. No host adapter was removed to force binary equality.

Evidence: `/private/tmp/texttext-installed-pc75-vs-mac4f-ui-20261019/comparison.json`, SHA256599aca26f780cddf7461bde8907f248fe676abe43966606a1b808053a4636db2. Neither app was launched for this check. This confirms packaged shared styling/markup and source parity, not rendered normal-flow acceptance or web deployment parity. See [rendered baseline](2026-10-17-visual-parity.md) and [Mac candidate](2026-10-19-mac-1273-4fdddd4a-candidate.md).
