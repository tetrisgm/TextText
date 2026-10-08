# Hosted folder task boundary

The canonical file tool adapter now accepts a server-issued `folderAgentPath`
additional to account permissions. It validates the path, applies an explicit
supported-tool allowlist, narrows manifests/search/folder lists, and checks
current paths on reads and mutation authorization callbacks. Owner access does
not bypass the task boundary. Creation and folder creation check destinations.

Workspace proposals validate destinations or resolved current item folders
before staging. The folder is recorded in durable proposal metadata, included
in keyed staging identity binding, and restored into the execution actor when
the owner approves. A malformed recorded boundary fails without execution.

Verification: 56 tests passed in `vault-tools.test.ts` and
`write-proposals.test.ts`; TypeScript passed. Logs:
`/tmp/texttext-hosted-folder-boundary.log`,
`/tmp/texttext-hosted-folder-types.log`.
New tests cover owner manifest/search/read narrowing, moved-file read denial,
malformed boundaries, out-of-folder creation proposal denial, and approval
retaining the staged folder after an ordinary owner approves it.

This is a server prerequisite, not live hosted folder-agent acceptance. The API
request/transport and folder action still need wiring. Folder template-library
commands remain outside this allowlist until their cross-library access rules
are explicitly implemented and tested. No Oracle deployment occurred here.

## Web request and transport follow-up

The shared web folder menu now opens an explicit folder task. Its HTTPS adapter
sends folder scope without reading an item, isolates history by target, and
rejects invalid folder/image/customization combinations. The AI route validates
the boundary and carries it into canonical context reads and tools; folder turns
skip the broad workspace index. The model receives only explicitly supported
folder tools and exact destination instructions. Web panel copy states that
changes need approval.

Transport, guarded tool catalog and adapter suites passed **29 tests**;
TypeScript passed. Existing rebuilt native folder-agent browser regression
passed dispatch, navigation fencing, isolated drafts and empty-root scope.
Logs: `/tmp/texttext-web-folder-transport.log`,
`/tmp/texttext-web-folder-types.log`, `/tmp/texttext-web-folder-browser.log`.
This still needs actual web browser task/approval acceptance and Oracle rollout;
the existing browser fixture verifies the desktop-shaped shared surface, not
live hosted execution. Template-library folder commands remain excluded.

## Folder proposal controls

Found and fixed an item-only rendering condition that hid proposal cards for
folder tasks. Cards now bind to the task's folder target, including the empty
workspace-root target. The existing approval component refreshes the listing
and dispatches the workspace-change event after confirmation.

The rebuilt browser fixture now runs both desktop and web-shaped VaultApp.
Web mode verifies folder navigation/dispatch plus visible root-folder approval,
posting the proposal decision and showing the saved receipt. It is included in
`test:web-assistant:browser`. Both modes and TypeScript passed.
Logs: `/tmp/texttext-web-folder-approval-browser.log`,
`/tmp/texttext-folder-proposal-native-browser.log`,
`/tmp/texttext-web-folder-approval-types.log`.
Network responses are fixtures; live hosted model/Oracle acceptance is pending.
