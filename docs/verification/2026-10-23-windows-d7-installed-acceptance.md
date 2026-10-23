# Windows d7a06af4 installed acceptance

Unified release delivered commit `d7a06af43455e205a780615131f955168d034346`. The real installed Windows executable at `%LOCALAPPDATA%/Programs/TextText/TextText.exe` passed one open/edit/save/normal quit/reopen cycle on October 23.

Existing owned fixture: `Notes/Untitled 31.textpack`, title `Windows launch acceptance 24104475 20261023`. Real editor input appended one release marker. Ctrl+S at 20:23:04.015 UTC; normal Alt+F4 at 20:23:10.138 UTC; window absent at 20:23:13.403 UTC. Reopened process 55560 displayed the exact whole body and Edit card at 20:23:34.471 UTC:

```text
Launch241 exact body L1. Reopened edit exact. Release a868426a exact reopen. Release d7a06af4 exact reopen.
```

The single uninstrumented first launch (PID 49300, process start 20:22:10.3326137 UTC) still displayed Open a workspace folder at 20:22:18.862 UTC (+8.53 s); the workspace and restored body were visible at 20:22:25.780 UTC (+15.45 s), without a bootstrap timeout notice. These coarse observations establish a target failure, not exact readiness timing. No five-launch loop was run. The malformed server catalog remains unresolved.

One diagnostic stack sample during the required reopen caught early WPF TextFormatter/TextBlock.Measure layout, before the workspace appeared. It contains no registry or SyncEngine frame and does not explain the later startup delay. Retained at `%TEMP%/texttext-d7-reopen-stack.txt`; the sampled reopen is not performance acceptance. No further launches or samples were taken. Native feed proposal staging was deferred when the owner directed work toward the known startup flaw. No catalog repair, deletion, journal reset, forced quit, or app-source modification occurred.
