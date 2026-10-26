# Shared template gallery cut

The shared workspace gallery exposed advanced edit, duplicate, import, version restore, and retirement actions through `WorkspaceTypeLibrary`. Those controls no longer fit the simple existing-look selection flow. The gallery now loads existing definitions and applies a selected look without wiring those lifecycle mutations. The read-only JSON export remains available.

Focused regression: an existing versioned look remains selectable while authoring and lifecycle controls stay absent. Mac and PC: the three `template-gallery-lifecycle` tests and TypeScript typecheck passed. This is a source check, not an installed app check. The local vault's separate “Save as look” and underlying lifecycle actions remain for later dependency review.
