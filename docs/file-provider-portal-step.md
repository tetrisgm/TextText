# File Provider: the one portal step (owner-gated)

Phase 1 (the pure-Swift kit) is shipped. Phase 2 builds the actual extension
that puts Write in the Finder sidebar, and that extension needs a signed App ID
and a Developer ID provisioning profile before it can register a real domain.
This is the same shape as the Share and Quick Look unblock, and it is the one
thing only you can do (it needs your Apple Developer account). It takes about
five minutes.

## What you are creating

- A new **App ID**: `net.writeapp.write.mac.fileprovider`
- With the **App Groups** capability enabled, using the existing group
  `group.net.writeapp.write` (already registered; do not make a new one).
- A **Developer ID provisioning profile** for that App ID, saved into
  `mac/profiles/Write_FileProvider_Developer_ID.provisionprofile`.

## Steps

1. Go to https://developer.apple.com/account/resources/identifiers/list and
   click the blue **+** next to Identifiers.
2. Choose **App IDs** -> **Continue** -> **App** -> **Continue**.
3. Description: `Write File Provider`. Bundle ID: **Explicit**,
   `net.writeapp.write.mac.fileprovider`.
4. Scroll the Capabilities list to **App Groups**, tick it. (You do not need to
   configure it here; the group is assigned by the profile/entitlement.)
   Click **Continue**, then **Register**.
5. Go to Profiles: https://developer.apple.com/account/resources/profiles/list
   Click **+**.
6. Under **Distribution**, choose **Developer ID** ->  **Continue**.
   (If it asks App Store vs Direct, choose the one that lets you pick an App ID
   and a Developer ID Application certificate, the same as Share/Quick Look.)
7. Select the App ID `net.writeapp.write.mac.fileprovider` -> **Continue**.
8. Select your **Developer ID Application** certificate -> **Continue**.
9. Name it `Write FileProvider Developer ID` -> **Generate** -> **Download**.
10. Move the downloaded `.provisionprofile` into this repo at exactly:
    `mac/profiles/Write_FileProvider_Developer_ID.provisionprofile`

That is all. Once the file is in `mac/profiles/`, the build script embeds and
signs the File Provider extension automatically (it no-ops without the profile,
exactly like Share/Quick Look), and Phase 2 can register a real domain and be
verified against a throwaway test workspace before it ever touches your real
one.

## Why a separate App ID

File Provider extensions are sandboxed and carry their own extension point and
entitlements; they cannot share the main app's App ID. The app group is what
lets the container app hand the `wsk_` sync token across to the extension, which
is why the group capability (not a new group) is the only capability it needs.
