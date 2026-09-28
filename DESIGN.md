# TextText design direction

The [content-first brief](docs/design/texttext-content-first-ux.md) governs this work. TextText is one place to write, save, read, collect visuals, and work with people and an agent. Items and folders stay in the existing TextPack model. This document summarizes presentation choices; storage, permission, collaboration, and recovery contracts still apply.

## Shell

Open the last useful location. A new workspace starts with a simple library and one clear creation action. Keep one folder hierarchy and an All items entry. Search and actions meet in Command-K. Starred, unread, type, and date are contextual filters; Shared with me, Trash, settings, help, feeds, and recovery remain discoverable. Do not duplicate the folder tree with hardcoded Writing, Bookmarks, and News destinations or a Home timeline.

The sidebar collapses and remembers its state. The agent opens on demand. A current item or folder header has its relevant creation action, participants, Share, and secondary menu. It does not keep search, capture, and chat inputs permanently competing for attention. Use available desktop width for libraries and visual grids, and a readable line measure for documents. Narrow layouts retain the same actions without horizontal overflow.

## Content surfaces

- **Writing:** title and editable body lead. A new note focuses writing immediately. Formatting and metadata appear when relevant. Preserve local typing, paste, IME, selection, undo, autosave, recovery, live collaboration, and explicit publishing.
- **Visuals:** images define the grid. Preserve useful proportions, small gutters, stable previews, and original assets. The viewer has a large image with contextual zoom, caption, source, dimensions, and comments. Large collections use still GIF previews and bounded image loading.
- **Saved links:** a standalone URL saves one link immediately; enrichment follows. The same item becomes a clean reader when capture succeeds. Title, source, article and Open original lead. Failed extraction leaves a usable link and retry. Personal notes, highlights, capture details, and summaries remain contextual.
- **Mixed folders:** show meaningful previews for notes, links and visual items. A folder's presentation does not change the identity or type of its contents.

Templates are safe, validated presentations and supported interactions over the same content. Provide a contextual Customize entry from the item, folder, or Command-K. Preview real content, refine, keep or cancel, save through ordinary permission and revision checks, and preserve the standard fallback. Personal view choices remain personal unless explicitly shared.

## Collaboration and agent

Keep participants and Share near the active material. Show actual human presence, comments, live edits, attribution, and short-lived agent activity without a permanent activity feed. A connected account is not an active collaborator. The in-app Add agent path starts from the person's current task, preserves it through supported authorization, returns to the same item, and shows real work or a reviewable preview. External MCP access remains separate. Do not imply a narrower grant or supported provider than the runtime enforces.

## Visual rules

Use neutral surfaces, readable text, restrained separators, consistent controls, clear selection and focus, and a subtle accent. Let content and images supply color. Avoid card borders around every row, nested rounded containers, badge walls, decorative AI effects, oversized administrative headings, and empty rails. Essential actions must not depend on hover. Check light and dark contrast, touch access, keyboard focus, reduced motion, and IME. Use sentence case and direct labels; no em dashes in product copy.

The concrete public references and limits of the inspection are in [reference notes](docs/design/content-first-reference-notes.md). The [September 28 baseline](docs/content-first-baseline-2026-09-28.md) is the pre-redesign production preview, with misses and unmeasured workloads stated explicitly. Verify actual rendered screens and realistic workloads rather than treating stylesheet or DOM assertions as visual proof.
