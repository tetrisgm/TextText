# Owned native image and hosted document readback

On normal installed Mac1269, the owner-controlled acceptance workflow imported repository fixture `public/fixtures/content-first/square.jpg` through the article Image menu and normal file picker, then selected Done. The reader screenshot visibly shows the article baseline and imported image. Normal Cmd-Q then returned App quit; after a first reopen observation timed out, the second actual UI observation showed the same reader baseline and square image. No reset or force-kill was used. Normal-reopen evidence is `normal-reopen.{txt,png}` in the same directory. Evidence: `/private/tmp/texttext-six-client-real-asset-20261019/{reader.txt,reader.png}`.

Owned item `f82e4082-97b8-4ccb-8087-70de5f0a3c86` is inside dedicated folder `Six-client acceptance 637ab1b5-c88b-48b7-b809-21acb4b29d78`. Independent read-only ZIP inspection found `Document.textbundle/assets/square.jpg`, **53,704 bytes**, SHA-256 `ed06a94f6b494148666ddcc13727aa3912aa8b750dab26da7d3f50fa620c6baf`, exactly matching the repository fixture.

Actual authenticated CLI read `/private/tmp/texttext-six-client-real-asset-read-20261019.json` returned the same item ID and body baseline with `![square](assets/square.jpg)` plus gallery metadata referencing the same asset path. Its hosted full-pack revision is `a88bd091fd142b0b791a92ecfd524ebf6bc8f56af5ed110d9582afb6726cc47f`. The local asset verification reads only this owned pack and does not rewrite it.

Hosted binary-entry byte/hash verification remains pending the physical agent's separate proof. A hosted Markdown asset reference alone does not prove those remote bytes. This receipt does not claim all-six-client convergence, a physical campaign, losing-version preservation or full attachment acceptance.
