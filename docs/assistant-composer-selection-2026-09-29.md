# Assistant composer selection recovery, 2026-09-29

The installed development-signed Mac app held the private local `Typing
benchmark 7d924acf` test note open with **Saved** visible. A read-only
Anthropic request inherited the composer's **Selection** context after focus
moved away from the editor. The chip said **Selected title text** although
only a title caret remained. The turn stopped before an answer with “This
selection could not be verified.” The note did not change. Turning Selection
off and asking again returned the exact Typing marker through a real `read_item`
tool call.

Composer context now ignores empty title and excerpt carets. A body caret
remains available for insertion requests and is labeled **Caret in body**;
nonempty selections still carry their exact source range. The context chip,
native prompt, cloud request, and item-context text use the same choice.

After the local web update, focusing the note title at a caret changed the
chip to **Editing** and removed the Selection toggle. The previously enabled
Selection preference did not attach an invalid envelope to a new request.
The installed app answered a fresh read-only title question through its real
Anthropic connection and `read_item`; the note remained **Saved**. Three
focused assistant suites passed 60 tests, TypeScript passed, and touched
ESLint had no errors (existing workspace-shell warnings remain). This is a
local development-server check, not a rebuilt native binary or public release.

A brief physical-footprint observation during this work moved from roughly
782 MiB across the installed app and its three WebKit processes before the
turns to roughly 951 MiB afterward. Development hot reload also ran during the
interval, so these readings cannot isolate agent retention or establish a
trend. A current-source production-mode active-agent run remains open.
