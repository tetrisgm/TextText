# Installed gallery import with owned asset

T20/T26 partial acceptance, October 18. Actual installed Mac **0.204 (1264)**, source `cd65ea30`; Oracle serves F994. This is one actual import, not the full five-template asset matrix.

Through the normal Gallery → Add images → Choose images workflow, imported the generated acceptance-coral PNG. The native picker selected only `/private/tmp/texttext-owned-acceptance-assets-20261018/acceptance-coral.png`. The installed lightbox displayed PNG, 64 × 64, 164 B, original download, colors and ordinary metadata controls.

Independent local archive read and authenticated CLI search/read confirmed:

- Item `82560b66-804d-4ffa-8e51-96f25670b559`, `Gallery/acceptance-coral.textpack`, built-in gallery template.
- Archive revision `7aa338dbb67bf0f42078abb9813052fe5aebc68c11dba25554e9fe7f58423a03` matches the server item.
- Original PNG bytes SHA-256 `86b7beed169ea7ab87f39182fbf7b19cbe36ccbcfa119956e0eb79707de865db`, exactly the generated input.
- The production pack/model reader returns a coherent pair with stored DocumentSnapshot unchanged.

The import's opaque projection sidecar retains a temporary ID; that is not the item's authoritative identity. Image staging generated the temporary pack ID, then the native import assigned the final Markdown ID while preserving opaque archive entries. The production parser rejects the mismatched projection baseline, uses the final Markdown identity matching the server, and reports coherent representations. An initial sidecar-only ID comparison was therefore corrected before counting identity acceptance. No marker or document was edited to conceal a mismatch.

Private evidence: `/private/tmp/texttext-t20-owned-assets-live-20261018` (actual installed screenshot and exact command results), `/private/tmp/texttext-gallery-id-readonly-20261018.json` (content-free structural diagnosis). Normal Cmd-Q then exited. The new image and retained draft state are preserved in the verified pre-1265 backup; manifest SHA-256 `450e54e8b7c20a574ad468955d028eddd83d6efd55721a811125a653ab39586f`.

Remaining: wider template/assets/UI/assistant/MCP workflows, final coherent-source delivery, independent original-asset download checks on other surfaces and installed acceptance after the authored-title fix. No whole-task completion claim.
