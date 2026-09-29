# Native Stop across an agent write, 2026-09-29

The installed development-signed Store-shaped TextText 0.202 (1114) used its bundled Codex runtime and the existing ChatGPT account against local Postgres. The private `Typing benchmark 7d924acf` test note began at revision 492651 with its original `Typing7d924acf:` marker intact.

An initial short request appended `Agent stop check 8f2b7c.` before there was time to press Stop. A later human line saved after that run. This run proves only an ordinary append followed by a human edit.

For the longer run, Codex was instructed to read three other Blog items before appending `Agent stop race 5a91e2c.` to the same note. The native assistant showed **Reading items in blog**. While it was still working, the human used the native editor to add `Human stop race 5a91e2c.` and saw **Saved**. The assistant then showed **Reading an exact source document** with Stop available. Stop was pressed. The transcript reported an append receipt followed by **The assistant was stopped** and its warning that some changes may already have been made.

The canonical local store immediately after Stop was revision 492655. It contained both the human and agent race lines and the original Typing marker. Six seconds later the revision and SHA-256 body hash were unchanged. The native editor also showed both lines, the marker, and **Saved**; Stop was gone and Retry message was available.

This is live evidence that a human edit made during an agent operation survived a Stop overlapping the agent's write and that the UI did not falsely claim the completed append was rolled back. The UI observations do not resolve whether the server received the append before or after the Stop click. A write already accepted by the server can finish; the cancellation fence blocks later tool calls from starting, not an accepted write from committing.
