# Detailed Gallery photo input

Selected-photo preparation now retries JPEG encoding at bounded smaller dimensions when the first 1600px preview exceeds the one-million-character native/hosted input limit. Each attempt renders the original bitmap, preserving aspect ratio, white transparency background and original embedded bytes. At most six attempts run; the decoded bitmap closes on every outcome.

Actual Chromium conversion covered a deterministic noisy 1600px square whose initial JPEG exceeds the limit, then verified a smaller JPEG within budget and unchanged original TextPack input. Existing exact selected-image, neighbor isolation and decode cancellation checks still pass. Receipt: `/tmp/texttext-gallery-noise-browser.log`. TypeScript and diff whitespace checks passed. This source change is not installed or deployed yet.
