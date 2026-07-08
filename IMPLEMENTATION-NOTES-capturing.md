# Bookmark Capture Status Notes

## Status endpoint

Added `GET /api/items/[id]/capture-status`.

The route is read-only. It looks up the item id, owning handle, and current
`captureStatus`, then calls `resolveItemAccess` with the current web session.
Callers without owner or granted item access receive `404`. The response shape
is:

```json
{ "captureStatus": "pending" }
```

`captureStatus` may be `pending`, `captured`, `failed`, or `null`.

## Polling

`BookmarkCard` now uses `useCaptureStatus` for cards whose initial
`captureStatus` is `pending`.

Polling starts after 3 seconds, backs off gently by 1 second per attempt up to
12 seconds, and stops after 3 minutes. When the endpoint returns `captured` or
`failed`, the hook updates the card state in place and asks Next to refresh the
route data so the completed capture metadata can replace the stale server
snapshot without a browser reload.

## Pending UI

Pending cards render a small spinner inside the `capturing` chip. The spinner
only animates under `prefers-reduced-motion: no-preference`; reduced-motion
users see the static ring.

While pending, the main bookmark link, thumbnail link, and capture action links
are not rendered as openable links. Once the status is `captured` or `failed`,
normal navigation returns. Failed captures show the `capture failed` chip.

## Verification

`npx tsc --noEmit` passed.
