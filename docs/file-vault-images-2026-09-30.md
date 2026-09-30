# File-backed image capture checkpoint

Implemented PNG, JPEG, GIF and WebP import into gallery TextPacks. Each pack
contains original bytes, a schema-v1 document and the complete built-in gallery
template. Original GIF animation bytes are retained. Import creates a fresh
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

## Still pending

This slice is not installed yet. Native and real web-server image roundtrips,
drop/paste checks, GIF still posters, meaningful mixed-folder thumbnails, viewer
navigation/zoom and realistic collection memory measurements remain. Reader
highlights also await installed native verification. Build 1121 is still the
canonical installed app. This checkpoint does not establish the full visual
collecting acceptance journey or completion of the product brief.
