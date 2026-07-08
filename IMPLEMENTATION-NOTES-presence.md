# Presence Implementation Notes

- Client ids are now stable for the browser session per post. `CollabProvider` stores the generated id in `sessionStorage` using the post id as part of the key, so editor remounts reuse the same presence row.
- Presence API results are deduped by normalized display name before returning active peers. If several live client ids exist for the same person, the newest row is used.
- `BodyEditor` no longer renders presence inside the editor body. It only owns the collaboration provider lifecycle and reports presence upward.
- `PostEditLayer` stores the current presence list and passes it into `PostActionBar`.
- `PostActionBar` renders a compact overlapping avatar stack next to Share. It also dedupes defensively before rendering, so counts and labels represent distinct people.
- Presence styles are scoped in `src/styles/apple.css` and use existing Apple editor theme tokens for light and dark chrome.

Verification:

- `npx tsc --noEmit` passes.
- No dev server was started.
