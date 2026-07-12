# File Provider "signed out" fix: main-app profile + keychain handoff

## What went wrong

In v0.29 the File Provider registered fine (Write appears in Finder under
Locations), but it showed "signed out" and never loaded. The extension reads the
workspace token from the app, and the app could not get it across:

- The app-group **container** does not work: a non-sandboxed app is **blocked
  from writing** a Group Container even with the app-group entitlement (the write
  is sandbox-gated, "Operation not permitted"). Verified on device.
- A shared **keychain** access group DOES work (it is not sandbox-gated):
  verified end to end that a non-sandboxed writer and a sandboxed reader with
  different bundle ids share an item via `<TeamID>.net.writeapp.write.fp`.

So the handoff goes through the keychain. Both the app and the extension carry a
`keychain-access-groups` entitlement, which only requires that the bundle carry
an embedded provisioning profile (the team-scoped keychain group is
self-authorized). That is why the main app still needs its own Developer ID
profile, the one portal step below. (Creating the App ID with App Groups is what
lets you generate that Developer ID profile; the profile is the load-bearing
part.)

## What you are creating

There is no `net.writeapp.write.mac` App ID yet (your portal has `net.writeapp.write`
plus the three `net.writeapp.write.mac.*` extensions; the main app never needed
its own App ID until now). So this is a NEW App ID.

- A NEW explicit **App ID** `net.writeapp.write.mac` (the main app) with the
  **App Groups** capability using the existing group `group.net.writeapp.write`.
- A **Developer ID** provisioning profile for it, saved into
  `mac/profiles/Write_App_Developer_ID.provisionprofile`.

## Steps

1. Identifiers -> blue **+** -> **App IDs** -> **Continue** -> **App** ->
   **Continue**.
2. Description: `Write Mac`. Bundle ID: **Explicit**, `net.writeapp.write.mac`
   (exactly, no `.fileprovider`).
3. In Capabilities, tick **App Groups**. Click the **Edit/Configure** next to it
   and check the existing group `group.net.writeapp.write` (do NOT make a new
   group). Then **Continue** -> **Register**.
4. Go to Profiles: https://developer.apple.com/account/resources/profiles/list
   Click **+**.
5. Under **Distribution**, choose **Developer ID** -> **Continue** (the same
   choice you made for the Share / Quick Look / File Provider profiles).
6. Select the App ID **`net.writeapp.write.mac`** -> **Continue**.
7. Select your **Developer ID Application** certificate -> **Continue**.
8. Name it `Write App Developer ID` -> **Generate** -> **Download**.
9. Move the downloaded `.provisionprofile` to exactly:
   `mac/profiles/Write_App_Developer_ID.provisionprofile`

That is all. Once the file is in `mac/profiles/`, the release build embeds it and
signs the main app with the app-group entitlement automatically (dev builds
without it still work, the File Provider just cannot authenticate). Then the app
can write the token, the extension reads it, and "Write" signs in.

## Why the app, not just the extension

The extension already has the app group. The missing half was the writer: the
non-sandboxed app could not put the token into the container. Giving the app the
same app group closes the loop. This is exactly how apps like Dropbox share a
token between their main app and their File Provider extension.
