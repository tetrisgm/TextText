# File-backed image capture checkpoint

Implemented PNG, JPEG, GIF and WebP import into gallery TextPacks. Each pack
contains original bytes, a schema-v1 document and the complete built-in gallery
template. Original GIF animation bytes are retained. GIF imports also embed a PNG still
preview (at most 1024 pixels on its longest side). Before decoding, the logical
canvas is bounded to eight million pixels using the [GIF format specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt). Temporary object URLs, image and canvas
resources are released after each import. Import creates a fresh
identity and an available destination filename, preserving existing files.

The shared Mac/web shell has an image picker. Folder views also accept file drop
and clipboard images; text inputs and open editors keep their existing paste
behavior. Batches are capped at 20 files and processed sequentially. Each image
is capped at 20 MiB; the transport caps complete incoming packs at 32 MiB.
Partial batch failure reports how many preceding files were saved.

Native import stages a temporary pack, delegates to the existing validated,
create-only document store on its serial IO queue, and removes staging files.
Web import preserves opaque pack entries and uses a fresh identity and the
existing conditional complete-pack write API.

## Evidence

- Eight tests passed across `image-import.test.ts` and `web-transport.test.ts`.
  They cover original GIF byte preservation, schema/gallery roundtrip, unique
  identities, opaque asset preservation, non-overwrite, unsafe paths, unsupported
  input and size rejection. `/tmp/texttext-image-import-tests.log`.
- Full TypeScript check and scoped ESLint passed.
  `/tmp/texttext-image-import-tsc.log`, `/tmp/texttext-image-eslint.log`.
- Native compilation and five existing `LocalVaultImportTests` passed with two
  Swift jobs. These exercise the underlying store, not the new bridge end to end.
  `/tmp/texttext-importpack-tests.log`.
- Offline browser fixture passed image picker -> complete pack -> exact original
  GIF bytes -> reopened gallery image, plus existing editor/conflict/reader tests.
  `/tmp/texttext-image-browser.log`. The first run used the wrong input role for
  the folder combobox; corrected to its accessible label, then reran successfully.

An expanded browser run also passed synthetic folder drop and clipboard image
paste, and checked that the embedded preview has PNG bytes and that original
GIF bytes and dimensions survive. `/tmp/texttext-gif-browser.log`. Full TypeScript
and scoped ESLint passed (`/tmp/texttext-gif-tsc.log`, `/tmp/texttext-gif-eslint.log`).
These synthetic gestures do not prove native physical gesture behavior.

## Still pending

Build **0.202 (1124)** is installed in `/Applications/TextText.app`. Its native
picker successfully imported `/tmp/texttext-native-1122.gif` to
`Gallery/texttext-native-1122.textpack`. Inspection of the actual saved ZIP
proved exact original GIF bytes plus a 161-byte PNG preview, relative references
and 1×1 dimensions. The installed UI reopened the gallery, opened the original
in its viewer, and toggled Zoom to Fit. The generated fixture was deleted through
the app's recoverable delete afterward. Build/install logs:
`/tmp/texttext-build-1124.log`, `/tmp/texttext-install-1124.log`.

Installed verification found and fixed two gaps missed by the browser fixture:
macOS requires a WKUIDelegate file picker, and local asset metadata must not use
the remote-URL mapping without a URL. The picker is restricted to the bundled
main frame and supported image types. Local assets retain the default empty
remote mapping; nine focused unit tests now pass (`/tmp/texttext-gif-tests.log`).
The intermediate 1122/1123 builds are superseded by 1124.

Real web-server image roundtrips, physical drop/paste checks, meaningful
mixed-folder thumbnails, multi-image viewer navigation and realistic collection
memory measurements remain. Reader highlights are installed but still await
native selection/persistence verification. This checkpoint does not establish the full visual
collecting acceptance journey or completion of the product brief.
