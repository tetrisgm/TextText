# Owned native image and hosted document readback

On normal installed Mac1269, the owner-controlled acceptance workflow imported repository fixture `public/fixtures/content-first/square.jpg` through the article Image menu and normal file picker, then selected Done. The reader screenshot visibly shows the article baseline and imported image. Normal Cmd-Q then returned App quit; after a first reopen observation timed out, the second actual UI observation showed the same reader baseline and square image. No reset or force-kill was used. Normal-reopen evidence is `normal-reopen.{txt,png}` in the same directory. Evidence: `/private/tmp/texttext-six-client-real-asset-20261019/{reader.txt,reader.png}`.

Owned item `f82e4082-97b8-4ccb-8087-70de5f0a3c86` is inside dedicated folder `Six-client acceptance 637ab1b5-c88b-48b7-b809-21acb4b29d78`. Independent read-only ZIP inspection found `Document.textbundle/assets/square.jpg`, **53,704 bytes**, SHA-256 `ed06a94f6b494148666ddcc13727aa3912aa8b750dab26da7d3f50fa620c6baf`, exactly matching the repository fixture.

Actual authenticated CLI read `/private/tmp/texttext-six-client-real-asset-read-20261019.json` returned the same item ID and body baseline with `![square](assets/square.jpg)` plus gallery metadata referencing the same asset path. Its hosted full-pack revision is `a88bd091fd142b0b791a92ecfd524ebf6bc8f56af5ed110d9582afb6726cc47f`. The local asset verification reads only this owned pack and does not rewrite it.

A separate authenticated hosted TextPack fetch returned HTTP200 with archive SHA-256 exactly `a88bd091fd142b0b791a92ecfd524ebf6bc8f56af5ed110d9582afb6726cc47f`; independent ZIP extraction verified the same 53,704-byte JPEG and exact SHA-256. Proof: `/private/tmp/texttext-browser-story-replay-3cbaa84b-20261019/hosted-pack-proof.json`. This establishes actual hosted bytes beyond the Markdown reference. This receipt does not claim all-six-client convergence, a physical campaign, losing-version preservation or full attachment acceptance.

## Installed retained-attachment export

On the same canonical Mac1269, actual Search and actions → Trash and recovery
showed the owned article's retained `assets/square.jpg`, size and exact digest.
Download attachment opened the normal native Save panel. A newly created private
directory and fresh filename avoided overwriting any existing file. Saving
`owned-retained-square.jpg` produced exactly53,704 bytes with SHA-256
`ed06a94f6b494148666ddcc13727aa3912aa8b750dab26da7d3f50fa620c6baf`.
The retained entry remained available; recovery was closed normally afterward.

Receipt and exported bytes: `/private/tmp/texttext-retained-asset-export-1269-20261019/`.
`receipt.json` records the item/entry/hash and `recovery-after-export.png` captures
the retained entry after saving. This verifies one real native retained-version
export. It does not prove replacing the active asset, selecting between two
different losing versions, Windows/browser export or complete attachment parity.
