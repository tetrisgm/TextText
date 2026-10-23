# Mac and web installed acceptance, 24104475

The human-invoked release completed with exit 0 and delivered all three surfaces
from `2410447543bd883cd23abd305ade14e183e6f5d7`. Evidence on the Mac:
`/private/tmp/texttext-ship-all-24104475-retry2.log` and
`.texttext/ship-all/20261023083328659-24104475/delivery.json`.

## Mac

Installed `/Applications/TextText.app`, **0.203 (1276)**. Created one note through
the real New note control and typed through accessibility-focused editor fields
using System Events, checking foreground ownership before keyboard input.
The generated title suffix remained before the typed title: persisted title
` 6Phase 2 Mac 24104475 20261023`, rendered as
`6Phase 2 Mac 24104475 20261023`.

Exact body:
`Mac 24104475 installed acceptance. Exact content survives normal quit and reopen.`

Normal application quit completed and process absence was confirmed. Reopened
the installed app; its actual Note card accessibility tree contained the same
title and exact body. Local canonical `Notes/6.textpack` independently contains
UUID `c4eca6f3-1799-4e37-8e08-c844592435e2` and that exact body. No journal or file
was edited outside the app.

## Live web

Used the existing authenticated Safari session and only the verification tab.
Created a note with the actual New note control, focused observed editor fields,
and typed with real keyboard input. Title `Phase 2 Web 24104475 20261023`; body:
`Web 24104475 live acceptance. Exact content survives tab close and reopen.`

Confirmed collaboration state `ready`, closed the verification tab normally,
then opened a new tab at workspace
`/vault/be28ae03-c64e-4695-80af-04f048f86f37`. The rendered reader contained the
exact title and body. Independent authenticated CLI search confirmed draft UUID
`ee455de6-5640-453c-8632-7984a370688c` with the same text.

## Convergence remains open

These checks establish local/client durability, not cross-client convergence.
The new Mac note was absent from hosted search, and the new hosted note was
absent from canonical Mac projection. The installed account menu reported:
`Sync is paused. Repair the local file or reopen this workspace to retry.`

Read-only investigation found the live server catalog includes three invalid
trailing-space folder names: `Phase3 `, `Phase3 A `, and `Phase3 A 98b5314a `.
They were created by the already-observed folder-view GET side effect. Mac's
whole-catalog validator rejects trailing spaces before reconciliation. The
folders, notes, and journals remain intact; no guard was bypassed or state reset.
Actual multiplayer overlap and exact three-client convergence are not accepted
by this receipt.
