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
