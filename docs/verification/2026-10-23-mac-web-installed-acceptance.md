# Mac and live web acceptance, October 23

Source: `98b5314ad0c7cc1193bb7e2828b967af6b4b12fd`.
Release evidence on the Mac:
`/Users/shokunin/dev/TextText/.texttext/ship-all/20261023074103440-98b5314a/delivery.json`;
log `/private/tmp/texttext-ship-all-98b5314a.log`.
The invocation delivered web and Mac, then stopped during Windows backup.
This receipt does not claim that invocation completed all three surfaces.

## Installed Mac

`/Applications/TextText.app`, version **0.203**, build **1275**.
Its `Contents/Resources/AppHealthBuildAttestation.json` records the source above.
Installer signature and architecture checks passed. Runtime health reported a
nonblocking `finder.provider` warning.

Test `mac-installed-normal-reopen-98b5314a`: clicked **New note** in the installed
app, focused its actual accessibility title/body fields, and typed real keyboard
input through System Events. Exact title:
`Phase 1 Mac 98b5314a 20261023`.
Exact body:
`Mac installed acceptance 98b5314a. Exact content survives normal quit and reopen.`

Requested normal application quit and confirmed the TextText process exited;
opened `/Applications/TextText.app` again. The actual Note card accessibility tree
showed the exact title and body. Independent authenticated CLI search subsequently
found note `0270a5d5-44da-4974-9e7d-d6f1ac8aaca1`, folder `Notes`, status `draft`,
with the same body. Initial automation clicks did not consistently focus the
contenteditable fields; explicit accessibility focus corrected the test's own
note before quit. This is not evidence of a product typing defect.

## Live web

Build identity: `texttext-all-20261023074103440-98b5314a`.
Used the existing authenticated Safari session and only a newly created tab.
Workspace: `/vault/be28ae03-c64e-4695-80af-04f048f86f37`.

Test `web-live-tab-reopen-98b5314a`: clicked the real **New note** button, then typed
with System Events into the observed title and document-body controls. Note:
`789e6f2b-02a3-463f-8c87-a723e4e67b23`.
Exact title: `Phase 1 Web 98b5314a 20261023`.
Exact body:
`Web live acceptance 98b5314a. Exact content survives tab close and reopen.`

Confirmed collaboration state `ready`, closed only the test tab normally, then
opened a new tab at the same workspace route. The rendered reader contained the
exact title and body. No API mutation substituted for UI input. Safari initially
had a minimized window: `visibilityState=hidden`, focus false, collaboration
`paused`. Unminimizing made it visible/focused and `ready`; no journal reset or
guard bypass was needed.

Both notes remain. Existing owner tabs and content were preserved. Proof was
direct accessibility/DOM readback; no screenshots were captured. These are real
installed/live checks, separate from simulated regression suites.
