# 30f167df live web convergence

Live `/api/app/build` returned `texttext-all-20261023232927060-30f167df`. Authenticated Safari used workspace `be28ae03-c64e-4695-80af-04f048f86f37`; the fresh reopened tab loaded script URLs with that same deployment ID.

After the installed Windows Keep both action and normal sync, authenticated read-only GETs verified both complete packs against Windows baselines:

| Item | Server path | Bytes | SHA256 |
| --- | --- | --- | --- |
| `080a76d5-f83d-456f-b893-67b869d27af2` | `Notes/Recovered-080a76d5-f83d-456f-b893-67b869d27af2.textpack` | 3087 | `9fe65e46a9d134a6740bf1a138ee921171c5bb2238830453bb6f824c65c05a00` |
| `ee455de6-5640-453c-8632-7984a370688c` | `Notes/Untitled 31.textpack` | 3357 | `5962859c2aae6ceb6893685962ba1b35804582f4dae3ddc84c24fbd4ed1026f9` |

Both returned HTTP 200, matching manifest revisions and editable permissions. These were full-byte comparisons, not title-only search. The inconclusive earlier Mac marker attempt left the server at the original hash; no Mac 30f marker is claimed.

After the normal-reopen recovery barrier, actual Safari keyboard input appended ` Web 30f167df verified.` to the shared note. Finish returned to the reader. At 2026-10-24T00:09:32Z, the server pack was 3426 bytes with SHA256 `0bc7505470d6887f97e8f8e71ca0042db62c35845ef36151bd46a6f37182face`. Normal closure of the owned verification tab followed by a fresh workspace tab restored this exact full body:

> Web 24104475 live acceptance. Exact content survives tab close and reopen. Verified web a868426a. Verified web d7a06af4. Mac ec300bb3 sync verified. Web ec300bb3 sync verified. Mac 044e5441 build1280 verified. Web 30f167df verified.

Mac and Windows agents were notified for independent installed peer observation. This receipt proves live web persistence and recovered server identities, not simultaneous editing, awareness, or peer convergence. No journal reset, direct file mutation, server deletion, or extra fixture was used.
