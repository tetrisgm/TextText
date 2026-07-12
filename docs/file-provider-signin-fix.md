# File Provider "signed out" fix: the main app needs the app group

## What went wrong

In v0.29 the File Provider registered fine (Write appears in Finder under
Locations), but it showed "signed out" and never loaded. The cause: the
extension reads the workspace token from the shared app-group container, and the
main app is the one that must write it there. A non-sandboxed app without the
app-group entitlement is **allowed to read** a Group Container but **blocked from
writing** to it ("Operation not permitted"), so the token never landed and the
extension had nothing to authenticate with.

The fix is to give the **main app** the app-group entitlement so it can write the
handoff into the exact container the extension reads. That entitlement is
restricted, so it needs an embedded Developer ID provisioning profile that
authorizes the group. This is the one thing only you can do (Apple Developer
account), and it is the same shape as the File Provider portal step you already
did.

## What you are creating

- The **App Groups** capability on the EXISTING App ID `net.writeapp.write.mac`
  (the main app), using the existing group `group.net.writeapp.write`.
- A **Developer ID** provisioning profile for `net.writeapp.write.mac`, saved into
  `mac/profiles/Write_App_Developer_ID.provisionprofile`.

## Steps

1. Go to https://developer.apple.com/account/resources/identifiers/list and click
   the App ID **`net.writeapp.write.mac`** (Description likely "Write" or
   "Write Mac").
2. In its capabilities, tick **App Groups** (if not already), make sure
   `group.net.writeapp.write` is the assigned group, then **Save**.
3. Go to Profiles: https://developer.apple.com/account/resources/profiles/list
   Click **+**.
4. Under **Distribution**, choose **Developer ID** -> **Continue** (the same
   choice you made for the Share / Quick Look / File Provider profiles).
5. Select the App ID **`net.writeapp.write.mac`** -> **Continue**.
6. Select your **Developer ID Application** certificate -> **Continue**.
7. Name it `Write App Developer ID` -> **Generate** -> **Download**.
8. Move the downloaded `.provisionprofile` to exactly:
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
