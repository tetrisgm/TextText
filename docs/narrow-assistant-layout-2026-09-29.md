# Narrow assistant layout verification

- Commit `ff643705` makes the assistant fill the window below 850 CSS pixels; the adjacent document layout resumes at 850px. The matching Library safe area and compact toolbar rules now apply only from 850 to 900px.
- In the local signed-in browser at 720x900 and 840x900, opening the assistant showed the full conversation, controls, and composer without a clipped document column. At 720px, the computed assistant bounds were 0-720px, `position: fixed`, and document scroll width equaled the viewport width. Closing it restored the full editable note and Saved status.
- At 850x900, the document and assistant were both visible; the document title, body, edit controls, and Saved status remained accessible. Document scroll width equaled viewport width. The 850px assistant column is narrow but its message and actions wrap within it.
- `simplification-contract.test.ts` passed 10 tests; touched test ESLint and `git diff --check` passed. This is browser layout evidence. The installed macOS app's 720-point minimum, light appearance, focus, and reduced-motion checks remain open.
