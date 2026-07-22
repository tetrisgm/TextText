# File Provider authentication and Finder actions

Texttext appears as a normal Finder Location through a replicated File Provider
extension. The main app owns sign-in and passes the minimum credential needed
by the extension through the shared keychain access group. The app group is
used for File Provider coordination and the signed extension relationship.

## Provisioned identities

The production build uses these explicit identifiers:

- Main app: `net.writeapp.write.mac`
- File Provider: `net.writeapp.write.mac.fileprovider`
- Shared app group: `group.net.writeapp.write`
- Shared keychain group: `<TeamID>.net.writeapp.write.fp`

The Developer ID profiles live in `mac/profiles/`. `build-app.sh` embeds the
main profile and `embed-extensions.sh` embeds the extension profile before the
outer app signature seals both. A signed release fails when the required app
group or profile is absent.

## Credential handoff

1. The signed-in app stores the `wsk_` sync bearer in the shared keychain group.
2. The File Provider extension reads that bearer and the pinned server origin.
3. The extension sends the bearer only to `/api/sync/v1` endpoints.
4. Sign-out removes the domain and credential handoff without deleting the
   server workspace.

No token is stored in Markdown, TextBundle metadata, Finder extended
attributes, public URLs, or health reports.

## Finder links and actions

The sync manifest carries two deliberately separate URLs:

- `url` is the authenticated content transport endpoint used by File Provider.
- `canonicalUrl` is the human-facing Texttext page used by Finder actions.

Copy Texttext Link, Share, and Manage Access use only `canonicalUrl`. The mapper
accepts an older public `url` for compatibility, but rejects any legacy value
whose path starts with `/api/sync/`. This prevents Finder from exposing a URL
that returns `A valid API token is required` in a browser.

Regression coverage:

- `WriteItemMapperTests` proves the canonical URL wins and a private transport
  URL is never published as item metadata.
- `FileProviderExtensionTests` proves Copy Texttext Link copies only the public
  page URL.
- `sync-http.test.ts` proves the server manifest emits both roles correctly.

## Operational checks

The installed app reports `finder.provider` as part of its content-blind app
health suite. Finder also presents native progress and error decorations from
File Provider. Texttext keeps every document downloaded and does not offer
online-only files or selective sync.
