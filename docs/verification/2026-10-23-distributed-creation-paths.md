# Distributed creation paths

Installed Windows and Mac retained different document UUIDs at `Notes/Untitled 31.textpack`. The shared web/Windows transport selected a numeric filename from its current listing, which cannot reserve a name on an offline peer. A focused two-client regression reproduced identical paths from identical stale listings.

Ordinary create/import now includes the newly generated document UUID in the filename while preserving the document title. Explicit folder-view `exactPath` remains unchanged and refuses an occupied destination. Existing paths are not renamed. Native creation replay still resumes its existing durable receipt before preparing another document.

Mac verification: web transport, Windows transport and Windows agent suites passed 72 tests, including creation replay, imports, and exact-path checks; TypeScript passed. Native Mac allocation is a separate follow-up. This source change awaits unified delivery and installed acceptance; it does not resolve existing path collisions.
