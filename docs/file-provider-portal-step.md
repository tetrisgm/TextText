# File Provider provisioning record

The owner-gated Apple Developer setup is complete. This file is a maintenance
record, not an outstanding setup step.

## Registered identity

- App ID: `app.texttext.mac.fileprovider`
- App group: `group.app.texttext`
- Distribution: Developer ID
- Local profile:
  `mac/profiles/TextText_FileProvider_Developer_ID.provisionprofile`

The File Provider extension needs its own App ID because it is a separately
sandboxed extension. The shared app group lets the signed container app hand
workspace connection data to it. Tokens themselves use the shared keychain
access group.

## Release behavior

`mac/scripts/embed-extensions.sh` embeds the extension, applies the profile,
and signs it. The release script then verifies the staged app with the
app-owned health command before notarization or upload. A missing, expired, or
mismatched File Provider profile is a release blocker.

## Renewal procedure

Only repeat Apple Developer portal work when the profile or certificate must be
renewed:

1. Keep the existing explicit App ID and app group assignment.
2. Generate a Developer ID profile for the existing File Provider App ID.
3. Replace the local profile at the exact path above.
4. Run the normal owner-facing ship command. Do not publish manually around a
   failed signing or health check.

Never register a second app group or change the extension identifier as part of
routine renewal.
